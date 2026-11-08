pub trait Left { fn act(&self) -> u8; }
pub trait Right { fn act(&self) -> u8; }
pub struct A;
pub struct B;
impl Left for A { fn act(&self) -> u8 { 1 } }
impl Left for B { fn act(&self) -> u8 { 2 } }
impl Right for A { fn act(&self) -> u8 { 3 } }

pub fn definite() { <A as Left>::act(&A); <A as Right>::act(&A); }
pub fn generic<T: Left>(x: T) { x.act(); T::act(&x); }
pub fn object(x: &dyn Left) { x.act(); }
pub fn ambiguous(x: &A) { x.act(); }
