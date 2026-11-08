pub trait Gate {
    fn enabled(&self) -> bool;
}

pub struct Other;

impl Other {
    pub fn enabled(&self) -> bool {
        true
    }
}

pub struct Wrapper<T> {
    inner: T,
}

impl<T: Gate> Wrapper<T> {
    pub fn as_ref(&self) -> &Other {
        &Other
    }

    pub fn check(&self) -> bool {
        self.as_ref().enabled()
    }
}
