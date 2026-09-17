package expo.modules.handsfree

import android.Manifest
import androidx.lifecycle.LifecycleOwner
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HandsFreeModule : Module() {
  private var engine: HandsFreeEngine? = null

  override fun definition() = ModuleDefinition {
    Name("HandsFreeModule")

    Events("onFrame", "onError")

    AsyncFunction("getPermission") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    AsyncFunction("start") { promise: Promise ->
      val activity = appContext.currentActivity
      val owner = activity as? LifecycleOwner
      if (activity == null || owner == null) {
        promise.reject("E_NO_ACTIVITY", "Hands-free needs the app in the foreground.", null)
        return@AsyncFunction
      }
      val current = engine ?: HandsFreeEngine(
        activity.applicationContext,
        emit = { sendEvent("onFrame", it) },
        onError = { sendEvent("onError", mapOf("message" to it)) },
      ).also { engine = it }
      current.start(owner) { error ->
        if (error == null) promise.resolve(null) else promise.reject("E_CAMERA", error, null)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") {
      engine?.stop()
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      engine?.stop()
    }

    OnDestroy {
      engine?.shutdown()
      engine = null
    }
  }
}
