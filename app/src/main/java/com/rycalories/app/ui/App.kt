package com.rycalories.app.ui

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.rycalories.app.ai.ModelState
import com.rycalories.app.ai.OnDeviceMealAnalyzer
import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.Meal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun RyCaloriesApp(vm: MainViewModel = viewModel()) {
    val screen by vm.screen.collectAsStateWithLifecycle()

    BackHandler(enabled = screen != Screen.Home) { vm.back() }

    when (val s = screen) {
        Screen.Home -> HomeScreen(vm)
        Screen.AddMeal -> AddMealScreen(vm)
        Screen.Result -> ResultScreen(vm)
        Screen.Settings -> SettingsScreen(vm)
        is Screen.Detail -> DetailScreen(vm, s.mealId)
    }
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(vm: MainViewModel) {
    val meals by vm.repository.meals.collectAsStateWithLifecycle()
    val settings by vm.settings.state.collectAsStateWithLifecycle()
    val day by vm.selectedDay.collectAsStateWithLifecycle()
    val modelState by vm.modelState.collectAsStateWithLifecycle()

    val dayMeals = remember(meals, day) {
        meals.filter { it.timestampMillis >= day && it.timestampMillis < day + MainViewModel.DAY_MS }
    }
    val totalCal = dayMeals.sumOf { it.calories }
    val isToday = day == MainViewModel.startOfToday()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("RyCalories") },
                actions = {
                    IconButton(onClick = { vm.navigate(Screen.Settings) }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { vm.startNewMeal() }) {
                Icon(Icons.Default.Add, contentDescription = "Add meal")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (modelState !is ModelState.Ready) {
                ModelStatusCard(
                    state = modelState,
                    onDownload = { vm.downloadModel() },
                    onRetry = { vm.refreshModelState() },
                )
            }

            DayHeader(
                dayMillis = day,
                isToday = isToday,
                onPrev = { vm.shiftDay(-1) },
                onNext = { vm.shiftDay(1) },
                onToday = { vm.goToToday() },
            )

            DailySummary(totalCal = totalCal, goal = settings.dailyGoal, meals = dayMeals)

            if (dayMeals.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (isToday) "Nothing logged yet.\nTap + to snap your next meal." else "No meals logged this day.",
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(dayMeals, key = { it.id }) { meal ->
                        MealRow(meal) { vm.navigate(Screen.Detail(meal.id)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ModelStatusCard(state: ModelState, onDownload: () -> Unit, onRetry: () -> Unit) {
    val isError = state is ModelState.Unavailable
    Card(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isError) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.secondaryContainer
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (state) {
                ModelState.Checking -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Checking the on-device model…")
                    }
                }
                ModelState.Downloadable -> {
                    Text("Gemini Nano needs a one-time download before it can look at your meals.", fontWeight = FontWeight.SemiBold)
                    Text(
                        "It runs entirely on this phone. Wi-Fi recommended.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Button(onClick = onDownload) { Text("Download model") }
                }
                is ModelState.Downloading -> {
                    Text("Downloading Gemini Nano…", fontWeight = FontWeight.SemiBold)
                    if (state.totalBytes > 0) {
                        val frac = (state.downloadedBytes.toFloat() / state.totalBytes).coerceIn(0f, 1f)
                        LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                        Text(
                            "${state.downloadedBytes / 1_000_000} / ${state.totalBytes / 1_000_000} MB",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    } else {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                }
                is ModelState.Unavailable -> {
                    Text("On-device model unavailable", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onErrorContainer)
                    Text(state.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = onRetry) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Check again")
                        }
                    }
                }
                ModelState.Ready -> Unit
            }
        }
    }
}

@Composable
private fun DayHeader(dayMillis: Long, isToday: Boolean, onPrev: () -> Unit, onNext: () -> Unit, onToday: () -> Unit) {
    val fmt = remember { SimpleDateFormat("EEE, d MMM", Locale.getDefault()) }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        IconButton(onClick = onPrev) { Icon(Icons.Default.ChevronLeft, contentDescription = "Previous day") }
        TextButton(onClick = onToday) {
            Text(if (isToday) "Today" else fmt.format(Date(dayMillis)), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        }
        IconButton(onClick = onNext, enabled = !isToday) { Icon(Icons.Default.ChevronRight, contentDescription = "Next day") }
    }
}

@Composable
private fun DailySummary(totalCal: Double, goal: Int, meals: List<Meal>) {
    val progress = if (goal > 0) (totalCal / goal).toFloat().coerceIn(0f, 1f) else 0f
    val over = goal > 0 && totalCal > goal
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("${totalCal.roundToInt()}", fontSize = 40.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text("/ $goal kcal", modifier = Modifier.padding(bottom = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)),
                color = if (over) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                MacroStat("Protein", meals.sumOf { it.proteinG })
                MacroStat("Carbs", meals.sumOf { it.carbsG })
                MacroStat("Fat", meals.sumOf { it.fatG })
            }
        }
    }
}

@Composable
private fun MacroStat(label: String, grams: Double) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("${grams.roundToInt()} g", fontWeight = FontWeight.SemiBold)
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MealRow(meal: Meal, onClick: () -> Unit) {
    val timeFmt = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumbnail(meal.photoPath, size = 64.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(meal.name, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    "${timeFmt.format(Date(meal.timestampMillis))} · P ${meal.proteinG.roundToInt()} · C ${meal.carbsG.roundToInt()} · F ${meal.fatG.roundToInt()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("${meal.calories.roundToInt()}", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(" kcal", modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun Thumbnail(path: String?, size: androidx.compose.ui.unit.Dp) {
    var bmp by remember(path) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(path) {
        bmp = if (path == null) null else withContext(Dispatchers.IO) { ImageUtils.loadFile(path, 256) }
    }
    Box(
        Modifier.size(size).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        val b = bmp
        if (b != null) {
            Image(b.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Text("🍽️", fontSize = 26.sp)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Add meal (photo / ingredients)
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddMealScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val draft by vm.draft.collectAsStateWithLifecycle()
    val modelState by vm.modelState.collectAsStateWithLifecycle()
    val modelReady = modelState is ModelState.Ready

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

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("New meal") },
                navigationIcon = {
                    IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val bmp = draft.bitmap
            if (bmp != null) {
                Box {
                    Image(
                        bmp.asImageBitmap(),
                        contentDescription = "Meal photo",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().height(280.dp).clip(RoundedCornerShape(16.dp)),
                    )
                    IconButton(
                        onClick = { vm.clearPhoto() },
                        modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)
                            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.8f), RoundedCornerShape(50)),
                    ) { Icon(Icons.Default.Close, contentDescription = "Remove photo") }
                }
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    FilledTonalButton(
                        onClick = { requestCamera.launch(android.Manifest.permission.CAMERA) },
                        modifier = Modifier.weight(1f).height(72.dp),
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Camera")
                    }
                    FilledTonalButton(
                        onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        modifier = Modifier.weight(1f).height(72.dp),
                    ) {
                        Icon(Icons.Default.PhotoLibrary, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Gallery")
                    }
                }
            }

            OutlinedTextField(
                value = draft.description,
                onValueChange = vm::setDescription,
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                label = { Text(if (bmp != null) "Extra details (optional)" else "Ingredients or description") },
                placeholder = {
                    Text(
                        if (bmp != null) "e.g. that's a large bowl, with olive oil dressing"
                        else "e.g. 2 eggs, 2 slices sourdough toast with butter, half an avocado"
                    )
                },
            )

            draft.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            if (!modelReady) {
                ModelStatusCard(
                    state = modelState,
                    onDownload = { vm.downloadModel() },
                    onRetry = { vm.refreshModelState() },
                )
            }

            Button(
                onClick = { vm.analyze() },
                enabled = modelReady && !draft.analyzing && (draft.jpeg != null || draft.description.isNotBlank()),
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) {
                if (draft.analyzing) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(12.dp))
                    Text("Thinking on-device…")
                } else {
                    Text("Estimate calories", fontSize = 16.sp)
                }
            }

            Text(
                "Analysis runs on this phone with Gemini Nano. Nothing is uploaded anywhere.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun newCaptureUri(context: android.content.Context): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

// ---------------------------------------------------------------------------------------------
// Result (review estimate before saving)
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResultScreen(vm: MainViewModel) {
    val draft by vm.draft.collectAsStateWithLifecycle()
    val a = draft.analysis
    if (a == null) {
        LaunchedEffect(Unit) { vm.back() }
        return
    }
    val m = draft.portionMultiplier.toDouble()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Estimate") },
                navigationIcon = {
                    IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
        bottomBar = {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = { vm.back() }, modifier = Modifier.weight(1f)) { Text("Retry") }
                Button(onClick = { vm.saveAnalyzedMeal() }, modifier = Modifier.weight(2f).height(52.dp)) {
                    Text("Save ${(a.totalCalories * m).roundToInt()} kcal")
                }
            }
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            draft.bitmap?.let {
                Image(
                    it.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(16.dp)),
                )
            }

            Text(a.mealName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("${(a.totalCalories * m).roundToInt()}", fontSize = 40.sp, fontWeight = FontWeight.Bold)
                        Text(" kcal", modifier = Modifier.padding(bottom = 8.dp))
                        Spacer(Modifier.weight(1f))
                        ConfidencePill(a.confidence)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        MacroStat("Protein", a.proteinG * m)
                        MacroStat("Carbs", a.carbsG * m)
                        MacroStat("Fat", a.fatG * m)
                    }
                }
            }

            Text("How much did you eat?", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0.5f to "Half", 0.75f to "¾", 1f to "All", 1.5f to "1½×", 2f to "2×").forEach { (mult, label) ->
                    FilterChip(
                        selected = draft.portionMultiplier == mult,
                        onClick = { vm.setPortionMultiplier(mult) },
                        label = { Text(label) },
                    )
                }
            }

            Text("Items", style = MaterialTheme.typography.titleSmall)
            Card(Modifier.fillMaxWidth()) {
                Column {
                    a.items.forEachIndexed { i, item ->
                        ItemRow(item, m)
                        if (i < a.items.lastIndex) HorizontalDivider()
                    }
                }
            }

            if (a.notes.isNotBlank()) {
                Text(a.notes, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ConfidencePill(confidence: String) {
    val color = when (confidence.lowercase()) {
        "high" -> MaterialTheme.colorScheme.primary
        "low" -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.secondary
    }
    Text(
        "${confidence.lowercase()} confidence",
        modifier = Modifier.background(color.copy(alpha = 0.15f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
        style = MaterialTheme.typography.labelMedium,
        color = color,
    )
}

@Composable
private fun ItemRow(item: FoodItem, multiplier: Double = 1.0) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(item.name, fontWeight = FontWeight.Medium)
            Text(
                "${item.portion} · P ${(item.proteinG * multiplier).roundToInt()} · C ${(item.carbsG * multiplier).roundToInt()} · F ${(item.fatG * multiplier).roundToInt()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("${(item.calories * multiplier).roundToInt()} kcal", fontWeight = FontWeight.SemiBold)
    }
}

// ---------------------------------------------------------------------------------------------
// Detail of a saved meal
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailScreen(vm: MainViewModel, mealId: String) {
    val meals by vm.repository.meals.collectAsStateWithLifecycle()
    val meal = meals.firstOrNull { it.id == mealId }
    if (meal == null) {
        LaunchedEffect(Unit) { vm.navigate(Screen.Home) }
        return
    }
    var confirmDelete by remember { mutableStateOf(false) }
    val fmt = remember { SimpleDateFormat("EEE d MMM, h:mm a", Locale.getDefault()) }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this meal?") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteMeal(meal.id) }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(meal.name, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Default.Delete, contentDescription = "Delete") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            var bmp by remember(meal.photoPath) { mutableStateOf<Bitmap?>(null) }
            LaunchedEffect(meal.photoPath) {
                bmp = meal.photoPath?.let { p -> withContext(Dispatchers.IO) { ImageUtils.loadFile(p, 1024) } }
            }
            bmp?.let {
                Image(
                    it.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().height(240.dp).clip(RoundedCornerShape(16.dp)),
                )
            }
            Text(fmt.format(Date(meal.timestampMillis)), color = MaterialTheme.colorScheme.onSurfaceVariant)

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("${meal.calories.roundToInt()}", fontSize = 40.sp, fontWeight = FontWeight.Bold)
                        Text(" kcal", modifier = Modifier.padding(bottom = 8.dp))
                        Spacer(Modifier.weight(1f))
                        ConfidencePill(meal.confidence)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        MacroStat("Protein", meal.proteinG)
                        MacroStat("Carbs", meal.carbsG)
                        MacroStat("Fat", meal.fatG)
                    }
                }
            }

            if (meal.items.isNotEmpty()) {
                Card(Modifier.fillMaxWidth()) {
                    Column {
                        meal.items.forEachIndexed { i, item ->
                            ItemRow(item)
                            if (i < meal.items.lastIndex) HorizontalDivider()
                        }
                    }
                }
            }
            meal.ingredientText?.let {
                Text("You wrote: $it", style = MaterialTheme.typography.bodyMedium)
            }
            if (meal.notes.isNotBlank()) {
                Text(meal.notes, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(vm: MainViewModel) {
    val current by vm.settings.state.collectAsStateWithLifecycle()
    val modelState by vm.modelState.collectAsStateWithLifecycle()
    var goal by remember { mutableStateOf(current.dailyGoal.toString()) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            OutlinedTextField(
                value = goal,
                onValueChange = { goal = it.filter(Char::isDigit).take(5) },
                label = { Text("Daily calorie goal") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { vm.saveSettings(goal.toIntOrNull() ?: 2000) },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Save") }

            HorizontalDivider()

            Text("Model", style = MaterialTheme.typography.titleMedium)
            Text(
                "Estimates come from ${OnDeviceMealAnalyzer.MODEL_NAME}, the same model Galaxy AI uses. " +
                    "It runs on the phone, works offline, and costs nothing.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when (modelState) {
                ModelState.Ready -> Text("Status: ready", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                else -> ModelStatusCard(
                    state = modelState,
                    onDownload = { vm.downloadModel() },
                    onRetry = { vm.refreshModelState() },
                )
            }
        }
    }
}
