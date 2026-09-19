package expo.modules.handsfree

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.RectF
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Front camera → MediaPipe face detector + hand landmarker, entirely on the
 * device. Emits one small frame per analysed camera frame: the face centre/size
 * and the 21 hand landmarks, both normalised to a mirrored, upright image so
 * that x grows to the user's right as they look at the screen. No pixels leave
 * this class and nothing is written to disk.
 *
 * Every frame also carries the upright size and the capture time in the
 * camera's own monotonic clock, so JS can do time-based, aspect-correct
 * gesture maths. Latency fields that compare the camera clock with the system
 * clock are only sent when the camera reports a REALTIME timestamp source.
 */
class HandsFreeEngine(
  private val context: Context,
  private val emit: (Map<String, Any?>) -> Unit,
  private val onError: (String) -> Unit,
) {
  // Analysis runs one notch below normal priority, and so do the hand model's
  // worker threads (created from this thread, they inherit it): the UI and
  // render threads win the two fast cores when both want them. Measured on a
  // Pixel 4a (2026-09-18): the model's workers took ~57% CPU with no hand in
  // view, mostly on the fast cores, and made the slowest frames worse. Not
  // THREAD_PRIORITY_BACKGROUND: on many devices that confines a thread to the
  // slow cores, which would slow recognition itself.
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread({
      Process.setThreadPriority(ANALYSIS_PRIORITY)
      r.run()
    }, "HandsFree-analysis")
  }
  private var provider: ProcessCameraProvider? = null
  private var analysis: ImageAnalysis? = null
  private var hands: HandLandmarker? = null
  private var faces: FaceDetector? = null
  @Volatile private var running = false
  // Bumped on every start and stop: a camera-provider callback from an older
  // start must not bind the camera after a stop.
  @Volatile private var generation = 0

  /** The face is only needed while a dish is open (head-tracked depth); skipping it saves ~10 ms a frame. */
  @Volatile var faceTracking = false

  /** "cpu" or "gpu". On the Pixel 4a the GPU was no faster and competes with the UI's render thread. */
  @Volatile var handDelegate = "cpu"
    set(value) {
      if (field == value) return
      field = value
      executor.execute { hands?.close(); hands = null }
    }
  private var handsDelegateInUse = "cpu"

  // Camera facts, read once per start.
  private var timestampRealtime = false
  private var fpsRange: Range<Int>? = null

  private var lastTimestamp = 0L
  private var seq = 0

  // Reused every frame: no per-frame bitmap allocation.
  private var raw: Bitmap? = null
  private var upright: Bitmap? = null
  private val matrix = Matrix()
  private var matrixKey = ""

  // With no hand in view for a while, analyse fewer frames (saves battery and heat).
  @Volatile private var lastHandSeenMs = 0L
  private var lastAnalysedMs = 0L

  private var lastError: String? = null
  private var lastErrorAt = 0L

  @OptIn(markerClass = [ExperimentalCamera2Interop::class])
  fun start(owner: LifecycleOwner, done: (String?) -> Unit) {
    if (running) return done(null)
    running = true
    lastHandSeenMs = SystemClock.elapsedRealtime() // start at full rate
    val gen = ++generation
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (gen != generation || !running) return@addListener done(null) // stopped while starting
      try {
        val cameraProvider = future.get()
        val info = Camera2CameraInfo.from(cameraProvider.getCameraInfo(CameraSelector.DEFAULT_FRONT_CAMERA))
        timestampRealtime = info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE) ==
          CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME
        // Ask for the fastest frame rate the camera actually lists, preferring a
        // fixed range (it also caps exposure, so a moving hand blurs less).
        val ranges = info.getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        fpsRange = ranges?.filter { it.upper <= 30 }?.maxWithOrNull(compareBy<Range<Int>>({ it.upper }, { it.lower }))

        val builder = ImageAnalysis.Builder()
        fpsRange?.let { Camera2Interop.Extender(builder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
        val useCase = builder
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setResolutionStrategy(
                ResolutionStrategy(Size(320, 240), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)
              )
              .build()
          )
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .build()
        useCase.setAnalyzer(executor) { image -> analyze(image, gen) }
        cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, useCase)
        provider = cameraProvider
        analysis = useCase
        done(null)
      } catch (e: Exception) {
        running = false
        done(e.message ?: "Couldn't open the front camera.")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  /** Call on the main thread. */
  fun stop() {
    running = false
    generation++
    analysis?.let { useCase ->
      useCase.clearAnalyzer()
      provider?.unbind(useCase)
    }
    analysis = null
    executor.execute {
      hands?.close(); hands = null
      faces?.close(); faces = null
      raw = null; upright = null; matrixKey = ""
    }
  }

  fun shutdown() {
    stop()
    executor.shutdown()
  }

  private fun ensureModels() {
    if (hands == null) {
      hands = try {
        createHands(if (handDelegate == "gpu") Delegate.GPU else Delegate.CPU).also { handsDelegateInUse = handDelegate }
      } catch (e: Exception) {
        Log.w("HandsFree", "$handDelegate hand model unavailable, using CPU", e)
        handsDelegateInUse = "cpu"
        createHands(Delegate.CPU)
      }
    }
    if (faceTracking && faces == null) {
      faces = FaceDetector.createFromOptions(
        context,
        FaceDetector.FaceDetectorOptions.builder()
          .setBaseOptions(BaseOptions.builder().setModelAssetPath("blaze_face_short_range.tflite").setDelegate(Delegate.CPU).build())
          .setRunningMode(RunningMode.VIDEO)
          .setMinDetectionConfidence(0.6f)
          .build()
      )
    }
  }

  private fun createHands(delegate: Delegate): HandLandmarker =
    HandLandmarker.createFromOptions(
      context,
      HandLandmarker.HandLandmarkerOptions.builder()
        .setBaseOptions(BaseOptions.builder().setModelAssetPath("hand_landmarker.task").setDelegate(delegate).build())
        .setRunningMode(RunningMode.VIDEO)
        .setNumHands(1)
        .setMinHandDetectionConfidence(0.6f)
        .setMinHandPresenceConfidence(0.6f)
        .setMinTrackingConfidence(0.5f)
        .build()
    )

  /** Copies the camera frame into a reused, upright, mirrored bitmap. */
  private fun uprightFrame(image: ImageProxy): Bitmap {
    val w = image.width
    val h = image.height
    val plane = image.planes[0]
    val src = if (plane.pixelStride == 4 && plane.rowStride == w * 4) {
      val b = raw?.takeIf { it.width == w && it.height == h } ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { raw = it }
      plane.buffer.rewind()
      b.copyPixelsFromBuffer(plane.buffer)
      b
    } else {
      image.toBitmap() // padded rows: let CameraX repack them
    }
    val rotation = image.imageInfo.rotationDegrees
    val key = "$w×$h@$rotation"
    if (key != matrixKey) {
      matrix.reset()
      matrix.postRotate(rotation.toFloat())
      matrix.postScale(-1f, 1f) // mirror: the front camera sees the user flipped
      val bounds = RectF(0f, 0f, w.toFloat(), h.toFloat())
      matrix.mapRect(bounds)
      matrix.postTranslate(-bounds.left, -bounds.top)
      upright = Bitmap.createBitmap(bounds.width().toInt(), bounds.height().toInt(), Bitmap.Config.ARGB_8888)
      matrixKey = key
    }
    val out = upright!!
    Canvas(out).drawBitmap(src, matrix, null)
    return out
  }

  private fun report(message: String) {
    // The same failure on every frame is one error, not thirty a second.
    val now = SystemClock.elapsedRealtime()
    if (message == lastError && now - lastErrorAt < 5000) return
    lastError = message
    lastErrorAt = now
    onError(message)
  }

  private fun analyze(image: ImageProxy, gen: Int) {
    try {
      if (!running || gen != generation) return
      val nowMs = SystemClock.elapsedRealtime()
      val away = nowMs - lastHandSeenMs
      val idle = !faceTracking && away > IDLE_AFTER_MS
      val interval = if (away > DEEP_IDLE_AFTER_MS) DEEP_IDLE_INTERVAL_MS else IDLE_INTERVAL_MS
      if (idle && nowMs - lastAnalysedMs < interval) return
      lastAnalysedMs = nowMs
      ensureModels()

      val t0 = SystemClock.elapsedRealtimeNanos()
      val frame = uprightFrame(image)
      val mpImage = BitmapImageBuilder(frame).build()
      val captureNs = image.imageInfo.timestamp
      // VIDEO mode needs strictly increasing timestamps (ms, camera clock).
      val ts = (captureNs / 1_000_000).let { if (it <= lastTimestamp) lastTimestamp + 1 else it }
      lastTimestamp = ts
      val t1 = SystemClock.elapsedRealtimeNanos()

      val payload = HashMap<String, Any?>()
      payload["seq"] = ++seq
      payload["t"] = SystemClock.uptimeMillis().toDouble()
      // Capture time in the camera's monotonic clock: valid for intervals whatever its source.
      payload["cap"] = captureNs / 1e6
      payload["w"] = frame.width
      payload["h"] = frame.height
      payload["idle"] = idle

      val face = if (!faceTracking) null else faces?.detectForVideo(mpImage, ts)?.detections()?.maxByOrNull { it.boundingBox().width() }
      if (face != null) {
        val box = face.boundingBox()
        payload["face"] = mapOf(
          "x" to (box.centerX() / frame.width).toDouble(),
          "y" to (box.centerY() / frame.height).toDouble(),
          "w" to (box.width() / frame.width).toDouble(),
        )
      }

      val t2 = SystemClock.elapsedRealtimeNanos()
      val landmarks = try {
        hands?.detectForVideo(mpImage, ts)?.landmarks()?.firstOrNull()
      } catch (e: Exception) {
        if (handsDelegateInUse == "cpu") throw e
        // The GPU failed mid-session: drop to the CPU once rather than failing every frame.
        Log.w("HandsFree", "GPU hand inference failed, switching to CPU", e)
        hands?.close()
        hands = createHands(Delegate.CPU)
        handsDelegateInUse = "cpu"
        null
      }
      val t3 = SystemClock.elapsedRealtimeNanos()
      if (landmarks != null && landmarks.size == 21) {
        lastHandSeenMs = nowMs
        val points = ArrayList<Double>(42)
        for (lm in landmarks) {
          points.add(lm.x().toDouble())
          points.add(lm.y().toDouble())
        }
        payload["hand"] = points
      }

      // Diagnostics: per-stage cost (copy+rotate, face, hand) and the delegate in use.
      payload["cost"] = listOf((t1 - t0) / 1e6, (t2 - t1) / 1e6, (t3 - t2) / 1e6)
      payload["delegate"] = handsDelegateInUse
      payload["fps"] = fpsRange?.let { listOf(it.lower, it.upper) }
      if (timestampRealtime) {
        // Only comparable with the system clock when the camera says so.
        payload["queued"] = (t0 - captureNs) / 1e6
        payload["wall"] = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - captureNs) / 1e6
        payload["sent"] = System.currentTimeMillis().toDouble()
      }
      emit(payload)
    } catch (e: Exception) {
      Log.w("HandsFree", "frame failed", e)
      report(e.message ?: "Hands-free frame failed")
    } finally {
      image.close()
    }
  }

  private companion object {
    const val IDLE_AFTER_MS = 2000L
    const val IDLE_INTERVAL_MS = 125L // ~8 frames a second while no hand is in view
    // After longer without a hand, ~3 a second: a hand is noticed within ~⅓ s,
    // and must be held still for 0.3 s before any gesture anyway (ARM_MS).
    const val DEEP_IDLE_AFTER_MS = 6000L
    const val DEEP_IDLE_INTERVAL_MS = 333L
    // Nice 5: between normal (0) and background (10).
    const val ANALYSIS_PRIORITY = 5
  }
}
