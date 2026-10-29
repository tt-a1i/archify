fn fallback() -> i32 {
    println!("fallback called");
    99
}
fn main() {
    let value = Some(7);
    let eager = value.unwrap_or(fallback());
    println!("unwrap_or: {eager}");
    let lazy = value
        .unwrap_or_else(|| fallback());
    println!("unwrap_or_else: {lazy}");
}