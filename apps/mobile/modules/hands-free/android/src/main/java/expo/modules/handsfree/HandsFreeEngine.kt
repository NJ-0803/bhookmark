package expo.modules.handsfree

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.hardware.camera2.CaptureRequest
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.annotation.OptIn
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
 * device. Emits one small frame per camera frame (up to 30/s): the face centre/size and
 * the 21 hand landmarks, both normalised to a mirrored, upright image so that
 * x grows to the user's right as they look at the screen. No pixels leave
 * this class and nothing is written to disk.
 */
class HandsFreeEngine(
  private val context: Context,
  private val emit: (Map<String, Any?>) -> Unit,
  private val onError: (String) -> Unit,
) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private var provider: ProcessCameraProvider? = null
  private var analysis: ImageAnalysis? = null
  private var hands: HandLandmarker? = null
  private var faces: FaceDetector? = null
  @Volatile private var running = false
  /** The face is only needed while a dish is open (head-tracked depth); skipping it saves ~10 ms a frame. */
  @Volatile var faceTracking = false
  private var handsOnGpu = false
  private var lastTimestamp = 0L

  @OptIn(markerClass = [ExperimentalCamera2Interop::class])
  fun start(owner: LifecycleOwner, done: (String?) -> Unit) {
    if (running) return done(null)
    running = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        val cameraProvider = future.get()
        val builder = ImageAnalysis.Builder()
        // A fixed 30 fps: the most frames the front camera gives, and it caps
        // exposure at 33 ms, so a moving hand blurs less.
        Camera2Interop.Extender(builder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(30, 30))
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
        useCase.setAnalyzer(executor) { image -> analyze(image) }
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
    analysis?.let { useCase ->
      useCase.clearAnalyzer()
      provider?.unbind(useCase)
    }
    analysis = null
    executor.execute {
      hands?.close(); hands = null
      faces?.close(); faces = null
    }
  }

  fun shutdown() {
    stop()
    executor.shutdown()
  }

  private fun ensureModels() {
    if (hands == null) {
      // The GPU runs the hand model several times faster than the CPU; fall back if it can't start.
      hands = try {
        createHands(Delegate.GPU).also { handsOnGpu = true }
      } catch (e: Exception) {
        Log.w("HandsFree", "GPU hand model unavailable, using CPU", e)
        handsOnGpu = false
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

  private fun analyze(image: ImageProxy) {
    try {
      if (!running) return
      val now = SystemClock.uptimeMillis()
      ensureModels()

      val t0 = SystemClock.elapsedRealtimeNanos()
      val raw = image.toBitmap()
      val matrix = Matrix().apply {
        postRotate(image.imageInfo.rotationDegrees.toFloat())
        postScale(-1f, 1f) // mirror: the front camera sees the user flipped
      }
      val upright = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
      val mpImage = BitmapImageBuilder(upright).build()
      // VIDEO mode needs strictly increasing timestamps.
      val ts = if (now <= lastTimestamp) lastTimestamp + 1 else now
      lastTimestamp = ts

      val payload = HashMap<String, Any?>()
      payload["t"] = now.toDouble()
      // Wall-clock time the camera captured this frame, so JS can measure the full delay to the screen.
      payload["wall"] = (System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - image.imageInfo.timestamp) / 1_000_000).toDouble()
      val t1 = SystemClock.elapsedRealtimeNanos()

      payload["gpu"] = handsOnGpu
      val face = if (!faceTracking) null else faces?.detectForVideo(mpImage, ts)?.detections()?.maxByOrNull { it.boundingBox().width() }
      if (face != null) {
        val box = face.boundingBox()
        payload["face"] = mapOf(
          "x" to (box.centerX() / upright.width).toDouble(),
          "y" to (box.centerY() / upright.height).toDouble(),
          "w" to (box.width() / upright.width).toDouble(),
        )
      }

      val t2 = SystemClock.elapsedRealtimeNanos()
      val landmarks = hands?.detectForVideo(mpImage, ts)?.landmarks()?.firstOrNull()
      val t3 = SystemClock.elapsedRealtimeNanos()
      // Per-stage cost in ms: image conversion, face detector, hand landmarker.
      payload["cost"] = listOf((t1 - t0) / 1e6, (t2 - t1) / 1e6, (t3 - t2) / 1e6)
      if (landmarks != null && landmarks.size == 21) {
        val points = ArrayList<Double>(42)
        for (lm in landmarks) {
          points.add(lm.x().toDouble())
          points.add(lm.y().toDouble())
        }
        payload["hand"] = points
      }
      // Test measurements: ms from capture to the analyser picking the frame up, and to sending it.
      payload["queued"] = (t0 - image.imageInfo.timestamp) / 1e6
      payload["sent"] = System.currentTimeMillis().toDouble()
      emit(payload)
    } catch (e: Exception) {
      Log.w("HandsFree", "frame failed", e)
      onError(e.message ?: "Hands-free frame failed")
    } finally {
      image.close()
    }
  }
}
