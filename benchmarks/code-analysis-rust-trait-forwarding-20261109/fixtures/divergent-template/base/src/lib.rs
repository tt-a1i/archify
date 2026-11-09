#![allow(dead_code)]

pub trait Left {
    fn work(&self) -> u8 {
        1
    }
}

pub trait Right {
    fn work(&self) -> u8 {
        2
    }
}

pub trait Runner {
    fn run(&self) -> u8;
}

macro_rules! shared_body {
    () => {
        fn run(&self) -> u8 {
            (**self).work()
        }
    };
}

impl<T: Left + ?Sized> Runner for &T {
    shared_body!();
}

impl<T: Right + ?Sized> Runner for Box<T> {
    shared_body!();
}
