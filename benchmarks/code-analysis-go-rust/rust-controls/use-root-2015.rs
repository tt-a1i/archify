#![allow(dead_code, unused_imports)]
mod a { pub struct A; pub fn run()->A { A } }
mod b { pub mod a { pub struct B; pub fn run()->B { B } } use a::run; pub fn check(){ let _: crate::a::A = run(); } }

