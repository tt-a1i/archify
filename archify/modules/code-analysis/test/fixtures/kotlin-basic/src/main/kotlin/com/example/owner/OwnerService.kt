package com.example.owner

import java.util.UUID

class OwnerService {

    private val owners = mutableListOf<Owner>()

    fun register(owner: Owner): Owner {
        if (owners.any { it.email == owner.email }) {
            throw OwnerAlreadyExistsException(owner.email)
        }
        owners.add(owner)
        return owner
    }

    fun findByName(name: String): Owner? {
        for (owner in owners) {
            if (owner.name == name) {
                return owner
            }
        }
        return null
    }

    fun rename(owner: Owner, name: String): Owner {
        validate(owner)
        return owner.copy(name = name)
    }

    private fun validate(owner: Owner) {
        require(owner.name.length <= Owner.MAX_NAME) { "name too long" }
    }
}

class OwnerAlreadyExistsException(val email: String) : RuntimeException("owner exists: $email")
