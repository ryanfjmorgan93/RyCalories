package com.rycalories.app.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SettingsState(
    val dailyGoal: Int = 2000,
)

/** Simple on-device settings. */
class AppSettings(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("rycalories", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(SettingsState(dailyGoal = prefs.getInt(KEY_GOAL, 2000)))
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    fun save(dailyGoal: Int) {
        prefs.edit().putInt(KEY_GOAL, dailyGoal).apply()
        _state.value = SettingsState(dailyGoal)
    }

    private companion object {
        const val KEY_GOAL = "daily_goal"
    }
}
