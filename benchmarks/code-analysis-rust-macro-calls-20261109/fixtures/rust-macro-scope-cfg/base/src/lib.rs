pub struct Parser;
pub struct Error;
impl Parser {
    pub fn parse(&self) -> Result<u8, Error> { Ok(1) }
}
macro_rules! ok { ($e:expr) => { $e }; }
pub fn local_discard(p: Parser) { macro_rules! ok { ($e:expr) => { () }; } let _ = ok!(p.parse()); }
macro_rules! cfg_drop { ($e:expr) => { { #[cfg(any())] let _ = $e; } }; }

pub fn cfg_deleted(p: Parser) { let _ = cfg_drop!(p.parse()); }


pub fn passthrough(p: Parser) { let _ = ok!(p.parse()); }
