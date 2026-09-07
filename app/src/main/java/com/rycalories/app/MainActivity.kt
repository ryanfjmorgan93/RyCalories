package com.rycalories.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.rycalories.app.ui.RyCaloriesApp
import com.rycalories.app.ui.RyCaloriesTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RyCaloriesTheme {
                RyCaloriesApp()
            }
        }
    }
}
