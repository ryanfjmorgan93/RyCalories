package com.rycalories.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Green = Color(0xFF2E7D32)
private val GreenDark = Color(0xFF81C784)
private val Orange = Color(0xFFEF6C00)
private val OrangeDark = Color(0xFFFFB74D)

private val LightColors = lightColorScheme(
    primary = Green,
    secondary = Orange,
    tertiary = Color(0xFF1565C0),
)

private val DarkColors = darkColorScheme(
    primary = GreenDark,
    secondary = OrangeDark,
    tertiary = Color(0xFF90CAF9),
)

@Composable
fun RyCaloriesTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
