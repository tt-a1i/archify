package com.example.owner;

import com.example.model.BaseEntity;
import java.util.ArrayList;
import java.util.List;

public class Owner extends BaseEntity {
  // Pet is in the same package: no import.
  private final List<Pet> pets = new ArrayList<>();

  public Owner() {
  }

  public void addPet(Pet pet) {
    if (pet == null) {
      throw new IllegalArgumentException("pet");
    }
    for (Pet existing : pets) {
      if (existing == pet || (existing.name().equals(pet.name()) && !pet.isNew())) {
        return;
      }
    }
    pets.add(pet);
  }
}
