pub mod provider {
    pub struct Item;

    impl Item {
        pub fn mark(&self) -> u8 {
            1
        }
    }

    pub fn with_item(f: impl FnOnce(&Item) -> u8) -> u8 {
        f(&Item)
    }

    pub fn with_generic<T, F: FnOnce(&T) -> u8>(value: &T, f: F) -> u8 {
        f(value)
    }
}

pub mod generic {
    use crate::provider::{with_generic, Item as ProviderItem};

    pub fn run() -> u8 {
        let item = ProviderItem;
        with_generic(&item, |item| item.mark())
    }
}

pub mod consumer {
    use crate::provider::with_item;

    pub struct Item;

    impl Item {
        #[allow(dead_code)]
        pub fn mark(&self) -> u8 {
            2
        }
    }

    pub fn run() -> u8 {
        with_item(|item| item.mark())
    }
}
