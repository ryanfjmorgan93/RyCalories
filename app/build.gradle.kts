plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.rycalories.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rycalories.app"
        // ML Kit GenAI (Gemini Nano via AICore) needs Android 12+.
        minSdk = 31
        targetSdk = 36
        versionCode = 5
        versionName = "2.3"

        // The MediaPipe runtime ships native code for four ABIs; the phone only needs arm64.
        ndk { abiFilters += "arm64-v8a" }
    }

    buildTypes {
        release {
            // R8 shrinks the unminified ~65 MB APK down to a sane size for sideloading.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Personal sideloaded app: sign with the debug key so it installs without a keystore.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
                "META-INF/INDEX.LIST",
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "**/module-info.class"
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.exifinterface:exifinterface:1.4.1")

    // On-device Gemini Nano through ML Kit's GenAI Prompt API. No API key, no cloud.
    implementation("com.google.mlkit:genai-prompt:1.0.0-beta4")
    // Only used to report whether the older Nano feature is enabled, for diagnostics.
    implementation("com.google.mlkit:genai-image-description:1.0.0-beta1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.10.2")

    // Fallback engine: Gemma 3n via MediaPipe LLM Inference, for phones where AICore says no.
    implementation("com.google.mediapipe:tasks-genai:0.10.35")
    implementation("com.google.mediapipe:tasks-core:0.10.35")
    // Generates the structured-output schema providers for @Generable classes.
    ksp("com.google.mlkit:genai-schema-compiler:1.0.0-alpha1")
}
