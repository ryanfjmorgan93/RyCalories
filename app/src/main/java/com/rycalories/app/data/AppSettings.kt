package com.rycalories.app.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SettingsState(
    val dailyGoal: Int = 2000,
    /** Absolute path of an imported Gemma 3n model file, or null if none. */
    val gemmaModelPath: String? = null,
)

/** Simple on-device settings. */
class AppSettings(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("rycalories", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(
        SettingsState(
            dailyGoal = prefs.getInt(KEY_GOAL, 2000),
            gemmaModelPath = prefs.getString(KEY_GEMMA, null),
        )
    )
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    fun saveGoal(dailyGoal: Int) {
        prefs.edit().putInt(KEY_GOAL, dailyGoal).apply()
        _state.value = _state.value.copy(dailyGoal = dailyGoal)
    }

    fun saveGemmaModelPath(path: String?) {
        prefs.edit().putString(KEY_GEMMA, path).apply()
        _state.value = _state.value.copy(gemmaModelPath = path)
    }

    private companion object {
        const val KEY_GOAL = "daily_goal"
        const val KEY_GEMMA = "gemma_model_path"
    }
}
