pub struct First;
pub struct Other;

impl First {
    pub fn enabled(&self) -> bool {
        false
    }
}

impl Other {
    pub fn enabled(&self) -> bool {
        true
    }
}

/// Local trait reusing the standard library name. Its method returns Other,
/// regardless of the trait argument.
pub trait AsRef<T> {
    fn as_ref(&self) -> &Other;
}

pub struct Wrap;

impl AsRef<First> for Wrap {
    fn as_ref(&self) -> &Other {
        &Other
    }
}

impl Wrap {
    pub fn check(&self) -> bool {
        self.as_ref().enabled()
    }
}

pub fn run(w: &Wrap) -> bool {
    w.as_ref().enabled()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatches_to_other() {
        assert!(run(&Wrap));
        assert!(Wrap.check());
    }
}
