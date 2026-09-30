export async function classStore<T>(
  value?: T,
  owner = "local",
): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("proof-class", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(
        "workspace",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("workspace");
      const request =
        value === undefined ? store.get(owner) : store.put(value, owner);
      let result: T | undefined;
      request.onsuccess = () => {
        result = value === undefined ? request.result : value;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
