#![allow(dead_code,non_snake_case)]
enum E { Make(u8) }
impl E { fn Make() -> Self { E::Make(0) } }
fn main(){let _=E::Make(1);}
