use std::fmt;

use borsh::{BorshDeserialize, BorshSerialize};
use sdk::merkle_utils::SHA256Hasher;
use serde::{
    de::{self, SeqAccess, Visitor},
    ser::{Serialize, SerializeSeq, Serializer},
    Deserialize, Deserializer,
};
use sha2::{Digest, Sha256};
use sparse_merkle_tree::{default_store::DefaultStore, traits::Value, SparseMerkleTree, H256};

use crate::{AccountInfo, AuthMethod};

#[derive(Debug, Default)]
pub struct AccountSMT(pub SparseMerkleTree<SHA256Hasher, AccountInfo, DefaultStore<AccountInfo>>);

impl Clone for AccountSMT {
    fn clone(&self) -> Self {
        let store = self.0.store().clone();
        let root = *self.0.root();
        let trie = SparseMerkleTree::new(root, store);
        Self(trie)
    }
}

// For the API
impl Serialize for AccountSMT {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let store = self.0.store();
        let map = store.leaves_map();
        let mut seq = serializer.serialize_seq(Some(map.len()))?;
        for (_, leaf_value) in map.iter() {
            seq.serialize_element(leaf_value)?;
        }
        seq.end()
    }
}

impl<'de> Deserialize<'de> for AccountSMT {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct AccountSMTVisitor;

        impl<'de> Visitor<'de> for AccountSMTVisitor {
            type Value = AccountSMT;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a list of accounts with their length prefix")
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let len: u32 = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(0, &self))?;

                let mut accounts = SparseMerkleTree::default();

                for i in 0..len {
                    let account: AccountInfo = seq
                        .next_element()?
                        .ok_or_else(|| de::Error::invalid_length((i + 1) as usize, &self))?;

                    let key = AccountInfo::compute_key(&account.identity);

                    accounts.update(key, account).map_err(de::Error::custom)?;
                }

                Ok(AccountSMT(accounts))
            }
        }

        deserializer.deserialize_seq(AccountSMTVisitor)
    }
}

impl BorshSerialize for AccountSMT {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        let store = self.0.store();
        let map = store.leaves_map();
        let len = map.len() as u32;
        borsh::BorshSerialize::serialize(&len, writer)?;
        for (_, leaf_value) in map.iter() {
            borsh::BorshSerialize::serialize(leaf_value, writer)?;
        }
        Ok(())
    }
}

impl BorshDeserialize for AccountSMT {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let len: u32 = borsh::BorshDeserialize::deserialize_reader(reader)?;
        let mut accounts = SparseMerkleTree::default();
        for _ in 0..len {
            let account: AccountInfo = borsh::BorshDeserialize::deserialize_reader(reader)?;
            let key = AccountInfo::compute_key(&account.identity);
            accounts
                .update(key, account)
                .expect("Failed to deserialize account");
        }

        Ok(AccountSMT(accounts))
    }
}

impl AccountInfo {
    pub fn compute_key(identity: &String) -> H256 {
        let mut hasher = Sha256::new();
        hasher.update(identity.as_bytes());
        let result = hasher.finalize();
        let mut h = [0u8; 32];
        h.copy_from_slice(&result);
        H256::from(h)
    }
}

impl Value for AccountInfo {
    fn to_h256(&self) -> H256 {
        if self.auth_method == AuthMethod::Uninitialized {
            return H256::zero();
        }

        let serialized = borsh::to_vec(self).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(&serialized);
        let result = hasher.finalize();
        let mut h = [0u8; 32];
        h.copy_from_slice(&result);
        H256::from(h)
    }

    fn zero() -> Self {
        AccountInfo::default()
    }
}
