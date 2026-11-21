package com.example.owner;

import org.springframework.validation.Validator;

// An external supertype could contribute a member type named Pet, so the body
// keeps the conservative guard and Pet stays unresolved.
public class PetValidator implements Validator {
  public boolean supports(Class<?> type) {
    return Pet.class.isAssignableFrom(type);
  }
}
