package com.rycalories.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Dark base with chunky pastel cards. Deliberately one look: no light mode. */
object Palette {
    val Bg = Color(0xFF0B0B0F)
    val Surface = Color(0xFF16161C)
    val SurfaceHi = Color(0xFF1F1F27)
    val Outline = Color(0x14FFFFFF)
    val Ink = Color(0xFF111015)          // text on pastel cards
    val InkSoft = Color(0x99111015)
    val Paper = Color(0xFFF7F5FF)        // white-ish card
    val Text = Color(0xFFF4F3F8)
    val TextDim = Color(0xFF9A98A6)

    val Orange = Color(0xFFFF5A1F)
    val Lavender = Color(0xFFD9C8FF)
    val Lemon = Color(0xFFF4EE7A)
    val Mint = Color(0xFF4FD08C)
    val Peach = Color(0xFFFFB38A)
    val Rose = Color(0xFFFF8FA3)
}

private val Colors = darkColorScheme(
    primary = Palette.Orange,
    onPrimary = Color.White,
    secondary = Palette.Lavender,
    onSecondary = Palette.Ink,
    tertiary = Palette.Mint,
    onTertiary = Palette.Ink,
    background = Palette.Bg,
    onBackground = Palette.Text,
    surface = Palette.Surface,
    onSurface = Palette.Text,
    surfaceVariant = Palette.SurfaceHi,
    onSurfaceVariant = Palette.TextDim,
    outline = Palette.Outline,
    error = Palette.Rose,
    onError = Palette.Ink,
    errorContainer = Color(0xFF3A1B22),
    onErrorContainer = Palette.Rose,
    secondaryContainer = Color(0xFF2A2440),
    onSecondaryContainer = Palette.Lavender,
)

private val Type = Typography(
    displayLarge = TextStyle(fontSize = 56.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-2).sp, lineHeight = 60.sp),
    displayMedium = TextStyle(fontSize = 40.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1.5).sp, lineHeight = 44.sp),
    headlineMedium = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.3.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp),
)

@Composable
fun RyCaloriesTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, typography = Type, content = content)
}
