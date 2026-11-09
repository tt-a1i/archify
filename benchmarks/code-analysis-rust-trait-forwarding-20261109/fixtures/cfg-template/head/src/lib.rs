#![allow(dead_code, unused_macros, unexpected_cfgs)]

pub trait Gate {
    fn check(&self) -> u8 {
        3
    }
}

pub struct Invocation;
impl Gate for Invocation {}
macro_rules! invocation_body {
    () => {
        pub fn run(&self) {
            self.check();
        }
    };
}
impl Invocation {
    #[cfg(feature = "chosen")]
    invocation_body!();
}

pub struct Method;
impl Gate for Method {}
macro_rules! method_body {
    () => {
        #[cfg(feature = "chosen")]
        pub fn run(&self) {
            self.check();
        }
    };
}
impl Method {
    method_body!();
}

pub struct Outer;
impl Gate for Outer {}
macro_rules! outer_body {
    () => {
        pub fn run(&self) {
            self.check();
        }
    };
}
#[cfg(feature = "chosen")]
impl Outer {
    outer_body!();
}

pub struct Attr;
impl Gate for Attr {}
macro_rules! attr_body {
    () => {
        pub fn run(&self) {
            self.check();
        }
    };
}
impl Attr {
    #[cfg_attr(not(feature = "chosen"), cfg(any()))]
    attr_body!();
}

pub struct Body;
impl Gate for Body {}
macro_rules! call_body {
    () => {
        pub fn run(&self) {
            #[cfg(feature = "chosen")]
            self.check();
        }
    };
}
impl Body {
    call_body!();
}

// rustc treats this unset custom cfg as false; the analyzer must retain unknown.
pub struct UnknownInvocation;
impl Gate for UnknownInvocation {}
macro_rules! unknown_invocation_body {
    () => {
        pub fn run(&self) {
            self.check();
        }
    };
}
impl UnknownInvocation {
    #[cfg(archify_unknown)]
    unknown_invocation_body!();
}

pub struct UnknownMethod;
impl Gate for UnknownMethod {}
macro_rules! unknown_method_body {
    () => {
        #[cfg(archify_unknown)]
        pub fn run(&self) {
            self.check();
        }
    };
}
impl UnknownMethod {
    unknown_method_body!();
}

pub struct UnknownOuter;
impl Gate for UnknownOuter {}
macro_rules! unknown_outer_body {
    () => {
        pub fn run(&self) {
            self.check();
        }
    };
}
#[cfg(archify_unknown)]
impl UnknownOuter {
    unknown_outer_body!();
}

pub struct UnknownBody;
impl Gate for UnknownBody {}
macro_rules! unknown_call_body {
    () => {
        pub fn run(&self) {
            #[cfg(archify_unknown)]
            self.check();
        }
    };
}
impl UnknownBody {
    unknown_call_body!();
}
