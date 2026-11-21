package com.example.owner;

public class Visit {
  public enum Kind { CHECKUP, SURGERY }

  Kind kind;
  Pet pet;

  int cost() {
    switch (kind) {
      case CHECKUP:
        return 40;
      case SURGERY:
        return 400;
      default:
        return 0;
    }
  }
}
