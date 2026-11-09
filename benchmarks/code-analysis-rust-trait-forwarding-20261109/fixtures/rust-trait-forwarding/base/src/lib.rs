pub trait Gate {
    fn check(&self) -> u8 {
        1
    }

    fn via_default(&self) -> u8 {
        self.check()
    }
}

pub struct Plain;
impl Gate for Plain {}

pub struct Override;
impl Gate for Override {
    fn check(&self) -> u8 {
        2
    }
}

macro_rules! forward {
    () => {
        fn check(&self) -> u8 {
            (**self).check()
        }
    };
}

impl<T: Gate + ?Sized> Gate for &mut T {
    forward!();
}

impl<T: Gate + ?Sized> Gate for Box<T> {
    forward!();
}

pub fn generic<G: Gate>(g: &G) -> u8 {
    g.check()
}

pub fn concrete_plain(p: &Plain) -> u8 {
    p.check()
}

pub fn concrete_override(o: &Override) -> u8 {
    o.check()
}

pub fn local_deref<G: Gate>(g: &mut &mut G) -> u8 {
    (**g).check()
}
