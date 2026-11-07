#![allow(dead_code, non_snake_case)]
use std::marker::PhantomData;
mod text {
    pub struct Regex;
    impl Regex { pub fn new() -> &'static str { "text" } }
}
mod bytes {
    pub struct Regex;
    impl Regex { pub fn new() -> &'static str { "bytes" } }
}
use text::Regex as Imported;
type Alias = text::Regex;
trait Build { fn new() -> &'static str; }
struct Selected;
impl Build for Selected { fn new() -> &'static str { "trait" } }
struct Factory;
impl Factory { fn new() -> &'static str { "nominal" } fn again() -> &'static str { Self::new() } }
struct Holder<T>(PhantomData<T>);
impl<Factory: Build> Holder<Factory> { fn call() -> &'static str { Factory::new() } }
fn nested() -> &'static str {
    fn inner<Factory: Build>() -> &'static str { Factory::new() }
    inner::<Selected>()
}
mod dual {
    pub struct Factory {}
    impl Factory { pub fn new() -> &'static str { "type" } }
    pub fn Factory() -> &'static str { "value" }
}
struct Generic<T>(PhantomData<T>);
impl Generic<u8> { fn new() -> &'static str { "u8" } }
impl Generic<u16> { fn new() -> &'static str { "u16" } }
struct Conditional;
#[cfg(feature="selected")]
impl Conditional { fn new() -> &'static str { "selected" } }
#[cfg(not(feature="selected"))]
impl Conditional { fn new() -> &'static str { "fallback" } }
fn main() {
    let values = [text::Regex::new(), bytes::Regex::new(), Imported::new(), Alias::new(),
        Selected::new(), <Selected as Build>::new(), Factory::again(),
        Holder::<Selected>::call(), nested(), dual::Factory::new(), dual::Factory(),
        Generic::<u8>::new(), Generic::<u16>::new(), Conditional::new()];
    println!("{}", values.join(","));
}
