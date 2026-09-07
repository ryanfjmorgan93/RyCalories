package com.rycalories.app.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SettingsState(
    val apiKey: String = "",
    val dailyGoal: Int = 2000,
)

/** Simple on-device settings. The API key never leaves the phone except in requests to Anthropic. */
class AppSettings(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("rycalories", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(
        SettingsState(
            apiKey = prefs.getString(KEY_API, "") ?: "",
            dailyGoal = prefs.getInt(KEY_GOAL, 2000),
        )
    )
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    fun save(apiKey: String, dailyGoal: Int) {
        prefs.edit().putString(KEY_API, apiKey.trim()).putInt(KEY_GOAL, dailyGoal).apply()
        _state.value = SettingsState(apiKey.trim(), dailyGoal)
    }

    private companion object {
        const val KEY_API = "anthropic_api_key"
        const val KEY_GOAL = "daily_goal"
    }
}
