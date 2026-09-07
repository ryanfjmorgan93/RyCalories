# RyCalories

A personal Android app that estimates the calories and macros of a meal from a photo
or from a typed list of ingredients, then keeps a daily log on the phone.

Analysis is done by Claude through the official Anthropic Java SDK. Nothing is stored
anywhere except on the phone itself (a JSON file plus JPEGs in the app's private storage).

## Get the APK

1. Push to GitHub. The **Build APK** workflow runs on every push.
2. Open the workflow run under the repo's **Actions** tab and download the
   `RyCalories-debug-apk` artifact. It contains `app-debug.apk`.
3. Copy the APK to the phone (or download it straight from GitHub on the phone),
   open it, and allow installs from that source when Android asks.

Or build locally with Android Studio / the Android SDK installed:

```
./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

## First run

1. Open **Settings** (gear icon) and paste an Anthropic API key from
   https://console.anthropic.com. Set a daily calorie goal.
2. Tap **+**, take a photo or pick one from the gallery, or just type the ingredients.
3. Tap **Estimate calories**, review the breakdown, pick how much you ate, and **Save**.

## How it works

- `app/src/main/java/com/rycalories/app/ai/ClaudeMealAnalyzer.kt` sends the image and/or
  text to `claude-opus-5` with a structured-output JSON schema, so the reply is always a
  well-formed list of items with calories, protein, carbs and fat.
- `data/MealRepository.kt` persists meals to `files/meals.json`; photos are saved as JPEGs
  under `files/photos/`.
- The UI is Jetpack Compose (`ui/App.kt`), one activity, no navigation library.

## Notes

- The API key is kept in app-private SharedPreferences. This is a single-user app on
  your own phone; treat it accordingly.
- Estimates are estimates. Portion sizes from photos are the main source of error;
  adding a short note like "large bowl" or "2 slices" improves them a lot.
