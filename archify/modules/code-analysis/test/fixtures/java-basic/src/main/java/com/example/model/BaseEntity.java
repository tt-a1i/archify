package com.example.model;

import java.io.Serializable;

// A listed JDK supertype: subclasses' bodies stay open to same-package names.
public class BaseEntity implements Serializable {
  protected Integer id;

  public boolean isNew() {
    return id == null;
  }
}
