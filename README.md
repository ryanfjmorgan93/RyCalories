# RyCalories

A personal Android app that estimates the calories and macros of a meal from a photo
or from a typed list of ingredients, then keeps a daily log on the phone.

Analysis runs **on the phone** using Gemini Nano through ML Kit's GenAI Prompt API. That is
the same on-device model Galaxy AI uses. There is no API key, no account, no cost, and no
upload: photos and the meal log never leave the device.

## Two engines, both on the phone

1. **Gemini Nano** through ML Kit's Prompt API. Zero download for the app, but Google's
   AICore service decides whether a given phone may use it. The app probes every model
   variant AICore offers and shows a diagnostics report if none is available.
2. **Gemma 3n** through MediaPipe's LLM Inference API, as a fallback. Google's open
   multimodal model, imported once from a `.litertlm` file (about 3 GB) via Settings.
   Works on any recent flagship regardless of AICore.

The app uses Nano when AICore allows it and Gemma otherwise.

## Requirements

- A phone on Google's supported list for Gemini Nano (Galaxy Z Fold 7/8, S25/S26 series,
  Pixel 9/10, and others). Android 12 or newer.
- Google's AICore app installed and up to date (it ships with the phone; the Play Store
  updates it).
- A one-time model download of roughly a few hundred MB to a couple of GB. The app
  prompts for it on first launch.

## Get the APK

Every push builds the app and updates a rolling GitHub release, so on the phone just open:

https://github.com/ryanfjmorgan93/RyCalories/releases/latest/download/RyCalories.apk

Open the downloaded file and allow installs from that source when Android asks.
The same APK is also attached to each run under the repo's **Actions** tab.

Or build locally with Android Studio / the Android SDK installed:

```
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

## First run

1. If the home screen shows a **Download model** card, tap it and wait (Wi-Fi recommended).
   If it shows **On-device model unavailable** instead, either wait a few minutes and tap
   Check again (AICore fetches configuration lazily), or go to Settings and import a Gemma 3n
   model: download `gemma-3n-E2B-it-int4.litertlm` from
   https://huggingface.co/google/gemma-3n-E2B-it-litert-lm (log in, accept the licence),
   then tap **Import model file**.
2. Tap **+**, take a photo or pick one from the gallery, or just type the ingredients.
3. Tap **Estimate calories**, review the breakdown, pick how much you ate, and **Save**.

## How it works

- `app/src/main/java/com/rycalories/app/ai/OnDeviceMealAnalyzer.kt` probes Gemini Nano
  variants, drives the download, runs inference, and builds the diagnostics report.
- `ai/GemmaMealAnalyzer.kt` loads the imported Gemma 3n file with MediaPipe (GPU first, CPU
  fallback), prompts for JSON, and parses it leniently.
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
