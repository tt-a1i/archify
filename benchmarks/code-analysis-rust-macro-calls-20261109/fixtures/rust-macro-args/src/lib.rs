pub struct Parser;
pub struct Error;
impl Parser {
    pub fn parse(&self) -> Result<u8, Error> { Ok(1) }
}

macro_rules! ok {
    ($e:expr) => { match $e { Ok(v) => v, Err(_) => panic!() } };
}
macro_rules! discard {
    ($e:expr) => { () };
}
macro_rules! twice {
    ($e:expr) => { let _ = ($e, $e); };
}
macro_rules! wrapped {
    ($e:expr) => { assert!($e) };
}
macro_rules! listed {
    ($($e:expr),*) => { vec![$($e),*] };
}

pub fn preserved(p: Parser) -> u8 { ok!(p.parse()) }
pub fn discarded(p: Parser) { discard!(p.parse()); }
pub fn duplicated(p: Parser) { twice!(p.parse()); }
pub fn wrapped_call(p: Parser) { wrapped!(p.parse().is_ok()); }
pub fn repeated(p: Parser) { let _ = listed!(p.parse().is_ok(), true); }

#[cfg(feature = "extra")]
pub fn feature_call(p: Parser) -> u8 { ok!(p.parse()) }
