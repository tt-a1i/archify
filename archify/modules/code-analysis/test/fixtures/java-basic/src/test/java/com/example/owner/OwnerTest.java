package com.example.owner;

import org.junit.jupiter.api.Test;

class OwnerTest {
  @Test
  void addsPet() {
    new Owner().addPet(new Pet());
  }
}
