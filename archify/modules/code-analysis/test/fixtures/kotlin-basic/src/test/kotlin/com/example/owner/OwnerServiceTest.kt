package com.example.owner

class OwnerServiceTest {
    fun `registers an owner`() {
        val service = OwnerService()
        val owner = Owner("Ada", "ada@example.com")
        service.register(owner)
        assert(service.findByName("Ada") != null)
    }
}
