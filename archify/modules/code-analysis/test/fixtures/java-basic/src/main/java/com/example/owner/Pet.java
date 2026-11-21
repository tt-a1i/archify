package com.example.owner;

import com.example.model.*;

// Named comes from an on-demand import; Visit.Kind is a member type in the same package.
public class Pet extends BaseEntity implements Named {
  private Owner owner;
  private Visit.Kind lastVisit;

  public String name() {
    return owner == null ? "" : "pet";
  }
}
