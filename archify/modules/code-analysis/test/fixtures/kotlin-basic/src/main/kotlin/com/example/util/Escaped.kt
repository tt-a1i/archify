package com.example.util

object Escaped {
    val greeting = """
        Hello "world"
        line two
    """.trimIndent()

    fun shout(input: String): String {
        var result = input.uppercase()
        when {
            result.isEmpty() -> result = "?"
            result.length > 10 -> result = result.substring(0, 10)
            else -> result = result.trim()
        }
        return result
    }
}
