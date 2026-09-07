# ML Kit GenAI structured output: providers are discovered via ServiceLoader and
# the schema classes are constructed by generated code. Keep them all intact.
-keep class com.rycalories.app.ai.NanoFoodItem { *; }
-keep class com.rycalories.app.ai.NanoMealEstimate { *; }
-keep class com.rycalories.app.ai.**_GeneratedProvider { *; }
-keep class * implements com.google.mlkit.genai.schema.guided.GenerableProvider { *; }
-keep class com.google.mlkit.genai.schema.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keep line numbers so crash logs from the phone stay readable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# The typed-output path builds the schema classes reflectively from Kotlin metadata.
-keep class kotlin.Metadata { *; }
-keepclassmembers class com.rycalories.app.ai.** { <init>(...); }

# Can't exercise this on a device in CI, so don't let R8 touch the ML Kit runtime at all.
-keep class com.google.mlkit.genai.** { *; }
-keep class com.google.android.gms.internal.mlkit_genai_** { *; }
-dontwarn com.google.mlkit.genai.**
