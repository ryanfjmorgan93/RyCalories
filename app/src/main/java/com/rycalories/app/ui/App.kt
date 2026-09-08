package com.rycalories.app.ui

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.rycalories.app.ai.GemmaMealAnalyzer
import com.rycalories.app.ai.ModelState
import com.rycalories.app.ai.OnDeviceMealAnalyzer
import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.Meal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private val CardShape = RoundedCornerShape(28.dp)
private val SmallShape = RoundedCornerShape(20.dp)
private val PillShape = RoundedCornerShape(50)

/** Macro targets derived from the calorie goal: 45% carbs, 30% protein, 25% fat. */
private data class MacroGoals(val carbs: Int, val protein: Int, val fat: Int) {
    companion object {
        fun from(goal: Int) = MacroGoals(
            carbs = (goal * 0.45 / 4).roundToInt(),
            protein = (goal * 0.30 / 4).roundToInt(),
            fat = (goal * 0.25 / 9).roundToInt(),
        )
    }
}

@Composable
fun RyCaloriesApp(vm: MainViewModel = viewModel()) {
    val screen by vm.screen.collectAsStateWithLifecycle()
    BackHandler(enabled = screen != Screen.Home) { vm.back() }
    Box(Modifier.fillMaxSize().background(Palette.Bg)) {
        when (val s = screen) {
            Screen.Home -> HomeScreen(vm)
            Screen.AddMeal -> AddMealScreen(vm)
            Screen.Result -> ResultScreen(vm)
            Screen.Settings -> SettingsScreen(vm)
            is Screen.Detail -> DetailScreen(vm, s.mealId)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------

@Composable
private fun PastelCard(
    color: Color,
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = CardShape,
    padding: Dp = 20.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val base = modifier.clip(shape).background(color)
    Column(
        (if (onClick != null) base.clickable(onClick = onClick) else base).padding(padding),
        content = content,
    )
}

@Composable
private fun DarkCard(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = CardShape,
    padding: Dp = 16.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val base = modifier.clip(shape).background(Palette.Surface).border(1.dp, Palette.Outline, shape)
    Column(
        (if (onClick != null) base.clickable(onClick = onClick) else base).padding(padding),
        content = content,
    )
}

@Composable
private fun RoundIconButton(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, onClick: () -> Unit, tint: Color = Palette.Text, bg: Color = Palette.Surface) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(bg).border(1.dp, Palette.Outline, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = desc, tint = tint, modifier = Modifier.size(20.dp)) }
}

@Composable
private fun ScreenHeader(title: String, onBack: () -> Unit, trailing: (@Composable () -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RoundIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", onBack)
        Spacer(Modifier.width(14.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f), maxLines = 1)
        trailing?.invoke()
    }
}

@Composable
private fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, color: Color = Palette.Orange, textColor: Color = Color.White) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.height(58.dp),
        shape = PillShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = color, contentColor = textColor,
            disabledContainerColor = Palette.SurfaceHi, disabledContentColor = Palette.TextDim,
        ),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = textColor)
            Spacer(Modifier.width(12.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, fontSize = 16.sp)
    }
}

@Composable
private fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Row(
        modifier.clip(PillShape).background(Palette.SurfaceHi).border(1.dp, Palette.Outline, PillShape).clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = Palette.Text, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = Palette.Text)
    }
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = Palette.Text, modifier = modifier)
}

/** Three-quarter arc gauge, the centrepiece of the calories card. */
@Composable
private fun ArcGauge(progress: Float, modifier: Modifier = Modifier, track: Color = Color(0x22111015), bar: Color = Palette.Ink, thickness: Dp = 22.dp, content: @Composable () -> Unit) {
    val animated by animateFloatAsState(progress.coerceIn(0f, 1f), animationSpec = tween(900), label = "gauge")
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = Stroke(width = thickness.toPx(), cap = StrokeCap.Round)
            val inset = thickness.toPx() / 2
            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
            val topLeft = Offset(inset, inset)
            drawArc(track, startAngle = 135f, sweepAngle = 270f, useCenter = false, topLeft = topLeft, size = arcSize, style = stroke)
            if (animated > 0f) {
                drawArc(bar, startAngle = 135f, sweepAngle = 270f * animated, useCenter = false, topLeft = topLeft, size = arcSize, style = stroke)
            }
        }
        content()
    }
}

@Composable
private fun MacroBar(progress: Float, color: Color, track: Color = Color(0x22111015)) {
    val animated by animateFloatAsState(progress.coerceIn(0f, 1f), animationSpec = tween(700), label = "macro")
    Box(Modifier.fillMaxWidth().height(8.dp).clip(PillShape).background(track)) {
        Box(Modifier.fillMaxWidth(animated).height(8.dp).clip(PillShape).background(color))
    }
}

@Composable
private fun Thumbnail(path: String?, size: Dp, shape: RoundedCornerShape = SmallShape) {
    var bmp by remember(path) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(path) {
        bmp = if (path == null) null else withContext(Dispatchers.IO) { ImageUtils.loadFile(path, 256) }
    }
    Box(Modifier.size(size).clip(shape).background(Palette.SurfaceHi), contentAlignment = Alignment.Center) {
        val b = bmp
        if (b != null) Image(b.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text("🍽️", fontSize = (size.value * 0.4f).sp)
    }
}

@Composable
private fun ConfidencePill(confidence: String, onDark: Boolean = false) {
    val color = when (confidence.lowercase()) {
        "high" -> Palette.Mint
        "low" -> Palette.Rose
        else -> Palette.Lemon
    }
    Text(
        "${confidence.lowercase()} confidence",
        modifier = Modifier.clip(PillShape).background(if (onDark) color.copy(alpha = 0.18f) else Color(0x1A111015)).padding(horizontal = 12.dp, vertical = 6.dp),
        style = MaterialTheme.typography.labelMedium,
        color = if (onDark) color else Palette.Ink,
    )
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

@Composable
private fun HomeScreen(vm: MainViewModel) {
    val meals by vm.repository.meals.collectAsStateWithLifecycle()
    val settings by vm.settings.state.collectAsStateWithLifecycle()
    val day by vm.selectedDay.collectAsStateWithLifecycle()
    val modelState by vm.modelState.collectAsStateWithLifecycle()
    val gemmaState by vm.gemmaState.collectAsStateWithLifecycle()
    val gemmaReady = gemmaState is GemmaState.Ready
    val nanoReady = modelState is ModelState.Ready

    val dayMeals = remember(meals, day) {
        meals.filter { it.timestampMillis >= day && it.timestampMillis < day + MainViewModel.DAY_MS }
    }
    val totalCal = dayMeals.sumOf { it.calories }
    val isToday = day == MainViewModel.startOfToday()
    val goals = MacroGoals.from(settings.dailyGoal)

    Scaffold(
        containerColor = Palette.Bg,
        floatingActionButton = {
            Row(
                Modifier.navigationBarsPadding().clip(PillShape).background(Palette.Orange).clickable { vm.startNewMeal() }.padding(horizontal = 22.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.CameraAlt, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text("Snap a meal", style = MaterialTheme.typography.labelLarge, color = Color.White, fontSize = 16.sp)
            }
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = padding.calculateBottomPadding() + 96.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { HomeHeader(onSettings = { vm.navigate(Screen.Settings) }) }

            if (!nanoReady && !gemmaReady) {
                item {
                    ModelStatusCard(
                        state = modelState,
                        onDownload = { vm.downloadModel() },
                        onRetry = { vm.refreshModelState() },
                        onSettings = { vm.navigate(Screen.Settings) },
                    )
                }
            }

            item {
                WeekStrip(
                    selectedDay = day,
                    onSelect = { vm.selectDay(it) },
                    onShiftWeek = { vm.shiftDay(it * 7) },
                )
            }

            item {
                CaloriesCard(totalCal = totalCal, goal = settings.dailyGoal, isToday = isToday, dayMillis = day)
            }

            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    MacroCard("Carbs", "🍞", dayMeals.sumOf { it.carbsG }, goals.carbs, Palette.Lemon, Modifier.weight(1f))
                    MacroCard("Protein", "🥚", dayMeals.sumOf { it.proteinG }, goals.protein, Palette.Mint, Modifier.weight(1f))
                    MacroCard("Fat", "🥑", dayMeals.sumOf { it.fatG }, goals.fat, Palette.Peach, Modifier.weight(1f))
                }
            }

            item {
                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    SectionTitle(if (isToday) "Today's meals" else "Meals", Modifier.weight(1f))
                    if (dayMeals.isNotEmpty()) {
                        Text("${dayMeals.size} logged", style = MaterialTheme.typography.labelMedium, color = Palette.TextDim)
                    }
                }
            }

            if (dayMeals.isEmpty()) {
                item {
                    DarkCard(Modifier.fillMaxWidth(), padding = 28.dp) {
                        Text("🍳", fontSize = 34.sp)
                        Spacer(Modifier.height(10.dp))
                        Text(
                            if (isToday) "Nothing logged yet" else "No meals this day",
                            style = MaterialTheme.typography.titleMedium, color = Palette.Text,
                        )
                        Text(
                            if (isToday) "Snap a photo or type what you ate and the phone will do the counting."
                            else "Pick another day above.",
                            style = MaterialTheme.typography.bodyMedium, color = Palette.TextDim,
                        )
                    }
                }
            } else {
                items(dayMeals, key = { it.id }) { meal ->
                    MealRow(meal) { vm.navigate(Screen.Detail(meal.id)) }
                }
            }

            if (!nanoReady && gemmaReady) {
                item {
                    Text(
                        "Running ${GemmaMealAnalyzer.MODEL_NAME}",
                        style = MaterialTheme.typography.labelMedium, color = Palette.TextDim,
                        modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

@Composable
private fun HomeHeader(onSettings: () -> Unit) {
    val hour = remember { Calendar.getInstance().get(Calendar.HOUR_OF_DAY) }
    val greeting = when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        in 17..21 -> "Good evening"
        else -> "Late one"
    }
    val dateFmt = remember { SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()) }
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(46.dp).clip(CircleShape).background(Palette.Lemon), contentAlignment = Alignment.Center) {
            Text("🍓", fontSize = 22.sp)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(greeting, style = MaterialTheme.typography.titleLarge, color = Palette.Text)
            Text(dateFmt.format(Date()), style = MaterialTheme.typography.bodySmall, color = Palette.TextDim)
        }
        RoundIconButton(Icons.Default.Settings, "Settings", onSettings)
    }
}

@Composable
private fun WeekStrip(selectedDay: Long, onSelect: (Long) -> Unit, onShiftWeek: (Int) -> Unit) {
    val today = MainViewModel.startOfToday()
    val monday = remember(selectedDay) {
        val cal = Calendar.getInstance().apply { timeInMillis = selectedDay }
        val offset = (cal.get(Calendar.DAY_OF_WEEK) + 5) % 7 // Monday = 0
        MainViewModel.startOfDay(selectedDay - offset * MainViewModel.DAY_MS)
    }
    val dayFmt = remember { SimpleDateFormat("EEE", Locale.getDefault()) }
    val monthFmt = remember { SimpleDateFormat("MMMM", Locale.getDefault()) }

    Column(Modifier.fillMaxWidth().clip(CardShape).background(Palette.Paper).padding(horizontal = 12.dp, vertical = 12.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(monthFmt.format(Date(monday + 3 * MainViewModel.DAY_MS)), style = MaterialTheme.typography.titleSmall, color = Palette.Ink, modifier = Modifier.weight(1f))
            IconButton(onClick = { onShiftWeek(-1) }, modifier = Modifier.size(30.dp)) {
                Icon(Icons.Default.ChevronLeft, contentDescription = "Previous week", tint = Palette.Ink)
            }
            IconButton(onClick = { onShiftWeek(1) }, modifier = Modifier.size(30.dp), enabled = monday + 7 * MainViewModel.DAY_MS <= today) {
                Icon(Icons.Default.ChevronRight, contentDescription = "Next week", tint = if (monday + 7 * MainViewModel.DAY_MS <= today) Palette.Ink else Palette.InkSoft.copy(alpha = 0.3f))
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            for (i in 0 until 7) {
                val d = monday + i * MainViewModel.DAY_MS
                val selected = d == selectedDay
                val future = d > today
                val cal = remember(d) { Calendar.getInstance().apply { timeInMillis = d } }
                Column(
                    Modifier
                        .clip(PillShape)
                        .background(if (selected) Palette.Lavender else Color.Transparent)
                        .clickable(enabled = !future) { onSelect(d) }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        dayFmt.format(Date(d)).take(3),
                        style = MaterialTheme.typography.labelMedium,
                        color = if (future) Palette.InkSoft.copy(alpha = 0.35f) else Palette.Ink,
                    )
                    Spacer(Modifier.height(6.dp))
                    Box(
                        Modifier.size(30.dp).clip(CircleShape).background(if (selected) Palette.Ink else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "%02d".format(cal.get(Calendar.DAY_OF_MONTH)),
                            style = MaterialTheme.typography.labelLarge,
                            color = when {
                                selected -> Color.White
                                future -> Palette.InkSoft.copy(alpha = 0.35f)
                                d == today -> Palette.Orange
                                else -> Palette.Ink
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CaloriesCard(totalCal: Double, goal: Int, isToday: Boolean, dayMillis: Long) {
    val left = goal - totalCal
    val progress = if (goal > 0) (totalCal / goal).toFloat() else 0f
    val over = left < 0
    val fmt = remember { SimpleDateFormat("EEE d MMM", Locale.getDefault()) }
    PastelCard(Palette.Lavender, Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Calories", style = MaterialTheme.typography.titleLarge, color = Palette.Ink, modifier = Modifier.weight(1f))
            Text(
                if (isToday) "Today" else fmt.format(Date(dayMillis)),
                style = MaterialTheme.typography.labelMedium, color = Palette.Ink,
                modifier = Modifier.clip(PillShape).background(Color(0x1A111015)).padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(Modifier.size(220.dp)) {
                ArcGauge(progress, Modifier.fillMaxSize(), bar = if (over) Palette.Orange else Palette.Ink) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "${kotlin.math.abs(left).roundToInt()}",
                            style = MaterialTheme.typography.displayMedium, color = Palette.Ink,
                        )
                        Text(if (over) "over" else "left", style = MaterialTheme.typography.labelLarge, color = Palette.InkSoft)
                    }
                }
                Row(
                    Modifier.fillMaxWidth().align(Alignment.BottomCenter).padding(horizontal = 34.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("0", style = MaterialTheme.typography.labelMedium, color = Palette.InkSoft)
                    Text("$goal", style = MaterialTheme.typography.labelMedium, color = Palette.InkSoft)
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            Stat("Eaten", "${totalCal.roundToInt()}")
            Stat("Goal", "$goal")
            Stat("Progress", "${(progress * 100).roundToInt()}%")
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
        Text(label, style = MaterialTheme.typography.labelSmall, color = Palette.InkSoft)
    }
}

@Composable
private fun MacroCard(label: String, emoji: String, grams: Double, goal: Int, color: Color, modifier: Modifier = Modifier) {
    PastelCard(color, modifier, shape = SmallShape, padding = 14.dp) {
        Box(Modifier.size(34.dp).clip(CircleShape).background(Color(0x22111015)), contentAlignment = Alignment.Center) {
            Text(emoji, fontSize = 16.sp)
        }
        Spacer(Modifier.height(16.dp))
        Text(label, style = MaterialTheme.typography.titleSmall, color = Palette.Ink)
        Spacer(Modifier.height(8.dp))
        MacroBar(if (goal > 0) (grams / goal).toFloat() else 0f, Palette.Ink)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${grams.roundToInt()}g", style = MaterialTheme.typography.labelSmall, color = Palette.Ink, fontWeight = FontWeight.Bold)
            Text("${goal}g", style = MaterialTheme.typography.labelSmall, color = Palette.InkSoft)
        }
    }
}

@Composable
private fun MealRow(meal: Meal, onClick: () -> Unit) {
    val timeFmt = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }
    DarkCard(Modifier.fillMaxWidth(), shape = SmallShape, padding = 12.dp, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Thumbnail(meal.photoPath, 62.dp, RoundedCornerShape(16.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(meal.name, style = MaterialTheme.typography.titleMedium, color = Palette.Text, maxLines = 1)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(timeFmt.format(Date(meal.timestampMillis)), style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
                    Text("·", style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
                    MacroTag("P", meal.proteinG, Palette.Mint)
                    MacroTag("C", meal.carbsG, Palette.Lemon)
                    MacroTag("F", meal.fatG, Palette.Peach)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${meal.calories.roundToInt()}", style = MaterialTheme.typography.headlineSmall, color = Palette.Text)
                Text("kcal", style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
            }
        }
    }
}

@Composable
private fun MacroTag(letter: String, grams: Double, color: Color) {
    Text(
        "$letter ${grams.roundToInt()}",
        style = MaterialTheme.typography.labelSmall,
        color = color,
    )
}

@Composable
private fun ModelStatusCard(state: ModelState, onDownload: () -> Unit, onRetry: () -> Unit, onSettings: (() -> Unit)? = null) {
    val bg = when (state) {
        is ModelState.Unavailable -> Palette.Rose
        else -> Palette.Lemon
    }
    PastelCard(bg, Modifier.fillMaxWidth(), shape = SmallShape, padding = 18.dp) {
        when (state) {
            ModelState.Checking -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Palette.Ink)
                    Spacer(Modifier.width(12.dp))
                    Text("Checking the on-device model…", style = MaterialTheme.typography.titleSmall, color = Palette.Ink)
                }
            }
            is ModelState.Downloadable -> {
                Text("One-time model download", style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
                Text("Gemini Nano runs entirely on this phone. Wi-Fi recommended.", style = MaterialTheme.typography.bodySmall, color = Palette.InkSoft)
                Spacer(Modifier.height(12.dp))
                PrimaryButton("Download model", onDownload, color = Palette.Ink)
            }
            is ModelState.Downloading -> {
                Text("Downloading Gemini Nano…", style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
                Spacer(Modifier.height(10.dp))
                if (state.totalBytes > 0) {
                    MacroBar((state.downloadedBytes.toFloat() / state.totalBytes), Palette.Ink)
                    Spacer(Modifier.height(6.dp))
                    Text("${state.downloadedBytes / 1_000_000} / ${state.totalBytes / 1_000_000} MB", style = MaterialTheme.typography.labelSmall, color = Palette.InkSoft)
                } else {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth().clip(PillShape), color = Palette.Ink, trackColor = Color(0x22111015))
                }
            }
            is ModelState.Unavailable -> {
                Text("On-device model unavailable", style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
                Spacer(Modifier.height(4.dp))
                Text(state.reason, style = MaterialTheme.typography.bodySmall, color = Palette.InkSoft)
                var showDetails by remember { mutableStateOf(false) }
                val clipboard = LocalClipboardManager.current
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Check again", onRetry, color = Palette.Ink)
                    if (state.details.isNotBlank()) {
                        TextButton(onClick = { showDetails = !showDetails }) {
                            Text(if (showDetails) "Hide details" else "Details", color = Palette.Ink)
                        }
                    }
                }
                if (showDetails && state.details.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(state.details, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = Palette.Ink)
                    TextButton(onClick = { clipboard.setText(AnnotatedString(state.details)) }) { Text("Copy details", color = Palette.Ink) }
                }
                if (onSettings != null) {
                    Spacer(Modifier.height(6.dp))
                    Text("Plan B: import a Gemma 3n model file in Settings and the app uses that instead.", style = MaterialTheme.typography.bodySmall, color = Palette.InkSoft)
                    TextButton(onClick = onSettings) { Text("Open Settings", color = Palette.Ink) }
                }
            }
            is ModelState.Ready -> Unit
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Add meal
// ---------------------------------------------------------------------------------------------

@Composable
private fun AddMealScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val draft by vm.draft.collectAsStateWithLifecycle()
    val modelState by vm.modelState.collectAsStateWithLifecycle()
    val gemmaState by vm.gemmaState.collectAsStateWithLifecycle()
    val engine = when {
        modelState is ModelState.Ready -> Engine.NANO
        gemmaState is GemmaState.Ready -> Engine.GEMMA
        else -> Engine.NONE
    }
    val modelReady = engine != Engine.NONE

    var pendingCaptureUri by remember { mutableStateOf<Uri?>(null) }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = pendingCaptureUri
        if (ok && uri != null) vm.setPhoto(uri)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.setPhoto(uri)
    }
    val requestCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            val uri = newCaptureUri(context)
            pendingCaptureUri = uri
            takePicture.launch(uri)
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("New meal", onBack = { vm.back() })
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val bmp = draft.bitmap
            if (bmp != null) {
                Box {
                    Image(
                        bmp.asImageBitmap(), contentDescription = "Meal photo", contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(CardShape),
                    )
                    Box(
                        Modifier.align(Alignment.TopEnd).padding(10.dp).size(38.dp).clip(CircleShape).background(Color(0xAA0B0B0F)).clickable { vm.clearPhoto() },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Default.Close, contentDescription = "Remove photo", tint = Color.White, modifier = Modifier.size(18.dp)) }
                }
            } else {
                PastelCard(Palette.Lavender, Modifier.fillMaxWidth(), padding = 22.dp) {
                    Text("📸", fontSize = 34.sp)
                    Spacer(Modifier.height(8.dp))
                    Text("Show me the plate", style = MaterialTheme.typography.headlineSmall, color = Palette.Ink)
                    Text("A photo from above with the whole plate in frame works best.", style = MaterialTheme.typography.bodyMedium, color = Palette.InkSoft)
                    Spacer(Modifier.height(16.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PrimaryButton("Camera", { requestCamera.launch(android.Manifest.permission.CAMERA) }, Modifier.weight(1f), color = Palette.Ink)
                        Row(
                            Modifier.weight(1f).height(58.dp).clip(PillShape).background(Color(0x1A111015)).clickable { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
                        ) {
                            Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Gallery", style = MaterialTheme.typography.labelLarge, color = Palette.Ink, fontSize = 16.sp)
                        }
                    }
                }
            }

            Text(if (bmp != null) "Anything to add?" else "Or just tell me", style = MaterialTheme.typography.titleMedium, color = Palette.Text)
            StyledTextField(
                value = draft.description,
                onValueChange = vm::setDescription,
                placeholder = if (bmp != null) "e.g. big bowl, olive oil dressing" else "e.g. 2 eggs, 2 slices sourdough with butter, half an avocado",
                minLines = 3,
            )

            draft.error?.let {
                PastelCard(Palette.Rose, Modifier.fillMaxWidth(), shape = SmallShape, padding = 14.dp) {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = Palette.Ink)
                }
            }

            if (!modelReady) {
                ModelStatusCard(
                    state = modelState,
                    onDownload = { vm.downloadModel() },
                    onRetry = { vm.refreshModelState() },
                    onSettings = { vm.navigate(Screen.Settings) },
                )
            }
            Spacer(Modifier.height(4.dp))
        }

        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 8.dp).navigationBarsPadding().padding(bottom = 12.dp)) {
            PrimaryButton(
                if (draft.analyzing) draft.stage.ifBlank { "Thinking on-device…" } else "Count it",
                onClick = { vm.analyze() },
                modifier = Modifier.fillMaxWidth(),
                enabled = modelReady && (draft.jpeg != null || draft.description.isNotBlank()),
                loading = draft.analyzing,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                when (engine) {
                    Engine.GEMMA -> "Runs on this phone with Gemma 3n. First run takes longer while the model loads."
                    else -> "Runs on this phone with Gemini Nano. Nothing is uploaded."
                },
                style = MaterialTheme.typography.labelSmall, color = Palette.TextDim,
                modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun StyledTextField(value: String, onValueChange: (String) -> Unit, placeholder: String, minLines: Int = 1, singleLine: Boolean = false, keyboardType: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        minLines = minLines,
        singleLine = singleLine,
        shape = SmallShape,
        placeholder = { Text(placeholder, color = Palette.TextDim) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Palette.Surface,
            unfocusedContainerColor = Palette.Surface,
            focusedBorderColor = Palette.Lavender,
            unfocusedBorderColor = Palette.Outline,
            cursorColor = Palette.Lavender,
            focusedTextColor = Palette.Text,
            unfocusedTextColor = Palette.Text,
        ),
    )
}

private fun newCaptureUri(context: android.content.Context): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

// ---------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------

@Composable
private fun ResultScreen(vm: MainViewModel) {
    val draft by vm.draft.collectAsStateWithLifecycle()
    val a = draft.analysis
    if (a == null) {
        LaunchedEffect(Unit) { vm.back() }
        return
    }
    val m = draft.portionMultiplier.toDouble()

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Your estimate", onBack = { vm.back() })
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            draft.bitmap?.let {
                Image(it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(210.dp).clip(CardShape))
            }
            NutritionHero(a.mealName, a.totalCalories * m, a.proteinG * m, a.carbsG * m, a.fatG * m, a.confidence)

            Text("How much did you eat?", style = MaterialTheme.typography.titleMedium, color = Palette.Text)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0.5f to "Half", 0.75f to "¾", 1f to "All", 1.5f to "1½×", 2f to "2×").forEach { (mult, label) ->
                    val selected = draft.portionMultiplier == mult
                    Box(
                        Modifier.weight(1f).clip(PillShape).background(if (selected) Palette.Orange else Palette.SurfaceHi)
                            .border(1.dp, if (selected) Palette.Orange else Palette.Outline, PillShape)
                            .clickable { vm.setPortionMultiplier(mult) }.padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, style = MaterialTheme.typography.labelLarge, color = if (selected) Color.White else Palette.Text) }
                }
            }

            Text("What's on the plate", style = MaterialTheme.typography.titleMedium, color = Palette.Text)
            ItemsCard(a.items, m)

            if (a.notes.isNotBlank()) {
                Text(a.notes, style = MaterialTheme.typography.bodyMedium, color = Palette.TextDim)
            }
            Spacer(Modifier.height(4.dp))
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 8.dp).navigationBarsPadding().padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            GhostButton("Retry", { vm.back() }, Modifier.weight(1f).height(58.dp))
            PrimaryButton("Save ${(a.totalCalories * m).roundToInt()} kcal", { vm.saveAnalyzedMeal() }, Modifier.weight(2f))
        }
    }
}

@Composable
private fun NutritionHero(name: String, kcal: Double, protein: Double, carbs: Double, fat: Double, confidence: String) {
    PastelCard(Palette.Lavender, Modifier.fillMaxWidth()) {
        Text(name, style = MaterialTheme.typography.headlineSmall, color = Palette.Ink)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${kcal.roundToInt()}", style = MaterialTheme.typography.displayLarge, color = Palette.Ink)
            Text(" kcal", style = MaterialTheme.typography.titleMedium, color = Palette.InkSoft, modifier = Modifier.padding(bottom = 12.dp))
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(bottom = 10.dp)) { ConfidencePill(confidence) }
        }
        Spacer(Modifier.height(14.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MacroChip("Protein", protein, Palette.Mint, Modifier.weight(1f))
            MacroChip("Carbs", carbs, Palette.Lemon, Modifier.weight(1f))
            MacroChip("Fat", fat, Palette.Peach, Modifier.weight(1f))
        }
    }
}

@Composable
private fun MacroChip(label: String, grams: Double, color: Color, modifier: Modifier = Modifier) {
    Column(modifier.clip(SmallShape).background(color).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text("${grams.roundToInt()}g", style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
        Text(label, style = MaterialTheme.typography.labelSmall, color = Palette.InkSoft)
    }
}

@Composable
private fun ItemsCard(items: List<FoodItem>, multiplier: Double) {
    DarkCard(Modifier.fillMaxWidth(), padding = 6.dp) {
        items.forEachIndexed { i, item ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.name, style = MaterialTheme.typography.titleMedium, color = Palette.Text, modifier = Modifier.weight(1f, fill = false))
                        if (item.source == "label") {
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "LABEL",
                                style = MaterialTheme.typography.labelSmall, color = Palette.Ink,
                                modifier = Modifier.clip(PillShape).background(Palette.Mint).padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (item.portion.isNotBlank()) Text(item.portion, style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
                        MacroTag("P", item.proteinG * multiplier, Palette.Mint)
                        MacroTag("C", item.carbsG * multiplier, Palette.Lemon)
                        MacroTag("F", item.fatG * multiplier, Palette.Peach)
                    }
                }
                Text("${(item.calories * multiplier).roundToInt()}", style = MaterialTheme.typography.titleLarge, color = Palette.Text)
                Text(" kcal", style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
            }
            if (i < items.lastIndex) Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).height(1.dp).background(Palette.Outline))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------

@Composable
private fun DetailScreen(vm: MainViewModel, mealId: String) {
    val meals by vm.repository.meals.collectAsStateWithLifecycle()
    val meal = meals.firstOrNull { it.id == mealId }
    if (meal == null) {
        LaunchedEffect(Unit) { vm.navigate(Screen.Home) }
        return
    }
    var confirmDelete by remember { mutableStateOf(false) }
    val fmt = remember { SimpleDateFormat("EEE d MMM · h:mm a", Locale.getDefault()) }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = Palette.Surface,
            title = { Text("Delete this meal?", color = Palette.Text) },
            text = { Text("It's gone for good, photo included.", color = Palette.TextDim) },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteMeal(meal.id) }) { Text("Delete", color = Palette.Rose) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep", color = Palette.Text) } },
        )
    }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(meal.name, onBack = { vm.back() }) {
            RoundIconButton(Icons.Default.Delete, "Delete", { confirmDelete = true }, tint = Palette.Rose)
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            var bmp by remember(meal.photoPath) { mutableStateOf<Bitmap?>(null) }
            LaunchedEffect(meal.photoPath) {
                bmp = meal.photoPath?.let { p -> withContext(Dispatchers.IO) { ImageUtils.loadFile(p, 1024) } }
            }
            bmp?.let {
                Image(it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(230.dp).clip(CardShape))
            }
            Text(fmt.format(Date(meal.timestampMillis)), style = MaterialTheme.typography.labelMedium, color = Palette.TextDim)
            NutritionHero(meal.name, meal.calories, meal.proteinG, meal.carbsG, meal.fatG, meal.confidence)
            if (meal.items.isNotEmpty()) {
                Text("What was on the plate", style = MaterialTheme.typography.titleMedium, color = Palette.Text)
                ItemsCard(meal.items, 1.0)
            }
            meal.ingredientText?.let {
                DarkCard(Modifier.fillMaxWidth(), shape = SmallShape) {
                    Text("You wrote", style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
                    Spacer(Modifier.height(4.dp))
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = Palette.Text)
                }
            }
            if (meal.notes.isNotBlank()) {
                Text(meal.notes, style = MaterialTheme.typography.bodyMedium, color = Palette.TextDim)
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

@Composable
private fun SettingsScreen(vm: MainViewModel) {
    val current by vm.settings.state.collectAsStateWithLifecycle()
    val modelState by vm.modelState.collectAsStateWithLifecycle()
    val gemmaState by vm.gemmaState.collectAsStateWithLifecycle()
    var goal by remember { mutableStateOf(current.dailyGoal.toString()) }
    val pickModel = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importGemmaModel(uri)
    }
    val goals = MacroGoals.from(goal.toIntOrNull() ?: 2000)

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Settings", onBack = { vm.back() })
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            PastelCard(Palette.Lemon, Modifier.fillMaxWidth()) {
                Text("Daily goal", style = MaterialTheme.typography.titleLarge, color = Palette.Ink)
                Text("Macro targets follow it: 45% carbs, 30% protein, 25% fat.", style = MaterialTheme.typography.bodySmall, color = Palette.InkSoft)
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = goal,
                        onValueChange = { goal = it.filter(Char::isDigit).take(5) },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        shape = SmallShape,
                        suffix = { Text("kcal", color = Palette.InkSoft) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = Color(0x1A111015), unfocusedContainerColor = Color(0x1A111015),
                            focusedBorderColor = Palette.Ink, unfocusedBorderColor = Color.Transparent,
                            focusedTextColor = Palette.Ink, unfocusedTextColor = Palette.Ink, cursorColor = Palette.Ink,
                        ),
                    )
                    PrimaryButton("Save", { vm.saveSettings(goal.toIntOrNull() ?: 2000) }, color = Palette.Ink)
                }
                Spacer(Modifier.height(10.dp))
                Text("≈ ${goals.carbs}g carbs · ${goals.protein}g protein · ${goals.fat}g fat", style = MaterialTheme.typography.labelMedium, color = Palette.Ink)
            }

            SectionTitle("Brains", Modifier.padding(top = 6.dp))
            DarkCard(Modifier.fillMaxWidth()) {
                Text(OnDeviceMealAnalyzer.MODEL_NAME, style = MaterialTheme.typography.titleMedium, color = Palette.Text)
                Text("The model Galaxy AI uses, via Google's AICore. Free, offline, nothing leaves the phone.", style = MaterialTheme.typography.bodySmall, color = Palette.TextDim)
                Spacer(Modifier.height(10.dp))
                when (val ms = modelState) {
                    is ModelState.Ready -> {
                        StatusLine("Ready", Palette.Mint)
                        Spacer(Modifier.height(6.dp))
                        Text(ms.details, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = Palette.TextDim)
                    }
                    else -> ModelStatusCard(state = modelState, onDownload = { vm.downloadModel() }, onRetry = { vm.refreshModelState() })
                }
            }

            DarkCard(Modifier.fillMaxWidth()) {
                Text(GemmaMealAnalyzer.MODEL_NAME, style = MaterialTheme.typography.titleMedium, color = Palette.Text)
                Text(
                    "Fallback if Nano stays locked. Download gemma-3n-E2B-it-int4.litertlm (about 3 GB) from " +
                        "huggingface.co/google/gemma-3n-E2B-it-litert-lm in your browser (log in, accept Google's licence once), " +
                        "then import it here. It's copied into the app, so the download can be deleted afterwards.",
                    style = MaterialTheme.typography.bodySmall, color = Palette.TextDim,
                )
                Spacer(Modifier.height(12.dp))
                when (val gs = gemmaState) {
                    GemmaState.None -> GhostButton("Import model file", { pickModel.launch(arrayOf("*/*")) })
                    is GemmaState.Importing -> {
                        Text("Copying model…", style = MaterialTheme.typography.titleSmall, color = Palette.Text)
                        Spacer(Modifier.height(8.dp))
                        if (gs.totalBytes > 0) {
                            MacroBar(gs.copiedBytes.toFloat() / gs.totalBytes, Palette.Lavender, track = Palette.SurfaceHi)
                            Spacer(Modifier.height(4.dp))
                            Text("${gs.copiedBytes / 1_000_000} / ${gs.totalBytes / 1_000_000} MB", style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
                        } else {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth().clip(PillShape), color = Palette.Lavender, trackColor = Palette.SurfaceHi)
                            Text("${gs.copiedBytes / 1_000_000} MB copied", style = MaterialTheme.typography.labelSmall, color = Palette.TextDim)
                        }
                    }
                    is GemmaState.Ready -> {
                        StatusLine("Ready · ${gs.sizeBytes / 1_000_000} MB", Palette.Mint)
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            GhostButton("Replace", { pickModel.launch(arrayOf("*/*")) })
                            TextButton(onClick = { vm.removeGemmaModel() }) { Text("Remove", color = Palette.Rose) }
                        }
                    }
                    is GemmaState.Error -> {
                        StatusLine(gs.message, Palette.Rose)
                        Spacer(Modifier.height(10.dp))
                        GhostButton("Try another file", { pickModel.launch(arrayOf("*/*")) })
                    }
                }
            }

            Text(
                "Estimates are estimates. Portion size is the main source of error; a short note like “large bowl” helps a lot.",
                style = MaterialTheme.typography.bodySmall, color = Palette.TextDim,
            )
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun StatusLine(text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, color = color)
    }
}
