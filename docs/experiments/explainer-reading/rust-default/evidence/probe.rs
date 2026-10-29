fn fallback(events: &mut Vec<&'static str>) -> i32 {
    events.push("fallback");
    99
}

fn main() {
    for (input_name, input) in [("Some(7)", Some(7)), ("None", None), ("Some(0)", Some(0))] {
        for mode in ["unwrap_or", "unwrap_or_else", "precomputed"] {
            let mut events = Vec::new();
            events.push("before");
            let result = match mode {
                "unwrap_or" => input.unwrap_or(fallback(&mut events)),
                "unwrap_or_else" => input.unwrap_or_else(|| fallback(&mut events)),
                "precomputed" => {
                    let ready = fallback(&mut events);
                    input.unwrap_or_else(|| ready)
                }
                _ => unreachable!(),
            };
            events.push("after");
            println!("{{\"input\":\"{}\",\"mode\":\"{}\",\"result\":{},\"events\":{:?}}}", input_name, mode, result, events);
        }
    }
}
