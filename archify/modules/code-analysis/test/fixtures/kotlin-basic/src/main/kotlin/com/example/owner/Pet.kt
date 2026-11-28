package com.example.owner

import com.example.model.BaseEntity

data class Pet(
    val name: String,
    val owner: Owner,
) : BaseEntity()
