// Authored compiler control, not an upstream project.
struct Unique<T>(T);
impl Unique<String> {
    fn new() -> Self { Self(String::new()) }
}
struct Choice<T>(T);
impl<T: Default> Choice<(T,)> {
    fn new() -> Self { Self((T::default(),)) }
}
impl Choice<String> {
    fn new() -> Self { Self(String::new()) }
}
fn main() {
    let _: Unique<String> = Unique::new();
    let _: Choice<String> = Choice::<String>::new();
    let _: Choice<(u8,)> = Choice::<(u8,)>::new();
}
