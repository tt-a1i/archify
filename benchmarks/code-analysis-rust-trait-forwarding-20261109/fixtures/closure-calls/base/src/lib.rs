pub trait Gate {
    fn check(&self) -> u8 { 1 }
}

pub struct W<T>(pub T);

pub fn with<T, F: FnOnce(&mut T) -> u8>(value: &mut T, f: F) -> u8 {
    f(value)
}

impl<R: Gate> W<R> {
    pub fn generic(&self, value: &mut R) -> u8 {
        with(value, |inner| inner.check())
    }
}

pub trait Leaf { fn touch(&self) -> u8 { 1 } }
pub struct L;
impl Leaf for L { fn touch(&self) -> u8 { 2 } }

pub fn with_impl(value: &mut L, f: impl FnOnce(&mut L) -> u8) -> u8 {
    f(value)
}

pub fn concrete(value: &mut L) -> u8 {
    with_impl(value, |inner| inner.touch())
}

pub fn with_dyn(value: &mut dyn Gate, f: impl FnOnce(&mut dyn Gate) -> u8) -> u8 {
    f(value)
}

pub fn dyn_call(value: &mut dyn Gate) -> u8 {
    with_dyn(value, |inner| inner.check())
}

pub struct Runner;

impl Runner {
    pub fn run<T, F: FnOnce(&mut T) -> u8>(&self, value: &mut T, f: F) -> u8 {
        f(value)
    }
}

pub fn via_method<R: Gate>(value: &mut R) -> u8 {
    Runner.run(value, |inner| inner.check())
}

pub fn iterate(values: &[L]) -> bool {
    values.iter().all(|inner| inner.touch() > 0)
}
