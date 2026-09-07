# RyCalories

A personal Android app that estimates the calories and macros of a meal from a photo
or from a typed list of ingredients, then keeps a daily log on the phone.

Analysis runs **on the phone** using Gemini Nano through ML Kit's GenAI Prompt API. That is
the same on-device model Galaxy AI uses. There is no API key, no account, no cost, and no
upload: photos and the meal log never leave the device.

## Requirements

- A phone on Google's supported list for Gemini Nano (Galaxy Z Fold 7/8, S25/S26 series,
  Pixel 9/10, and others). Android 12 or newer.
- Google's AICore app installed and up to date (it ships with the phone; the Play Store
  updates it).
- A one-time model download of roughly a few hundred MB to a couple of GB. The app
  prompts for it on first launch.

## Get the APK

1. Push to GitHub. The **Build APK** workflow runs on every push.
2. Open the workflow run under the repo's **Actions** tab and download the
   `RyCalories-apk` artifact. It contains `app-release.apk`.
3. Copy the APK to the phone (or download it straight from GitHub on the phone),
   open it, and allow installs from that source when Android asks.

Or build locally with Android Studio / the Android SDK installed:

```
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

## First run

1. If the home screen shows a **Download model** card, tap it and wait (Wi-Fi recommended).
2. Tap **+**, take a photo or pick one from the gallery, or just type the ingredients.
3. Tap **Estimate calories**, review the breakdown, pick how much you ate, and **Save**.

## How it works

- `app/src/main/java/com/rycalories/app/ai/OnDeviceMealAnalyzer.kt` checks whether Gemini
  Nano is available, drives the download, and runs inference.
- `ai/NanoSchema.kt` declares the answer shape with `@Generable` / `@Guide` annotations.
  ML Kit's schema compiler turns that into constrained decoding, so the model can only reply
  with a well-formed list of items, each with calories, protein, carbs and fat. Totals are
  summed in code rather than trusted from the model.
- `data/MealRepository.kt` persists meals to `files/meals.json`; photos are saved as JPEGs
  under `files/photos/`.
- The UI is Jetpack Compose (`ui/App.kt`), one activity, no navigation library.

## Notes

- Gemini Nano is a small model. It is decent at naming foods and rough calories, weaker at
  judging portion sizes. Adding a short note like "large bowl" or "2 slices" helps a lot,
  and the portion picker on the result screen lets you scale the estimate.
- ML Kit's GenAI Prompt API is in beta. If a Play Services or AICore update changes
  behaviour, the model card on the home screen shows what went wrong.
