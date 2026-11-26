package com.example.owner

import com.example.model.BaseEntity
import com.example.model.Named

class Owner(
    override val name: String,
    val email: String,
) : BaseEntity(), Named {

    fun label(): String = "${name} <${email}>"

    companion object {
        const val MAX_NAME: Int = 80
    }
}
