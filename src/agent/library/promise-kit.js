
export const makePromiseKit = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
  });
  return { promise, resolve, reject };
}

export const never = makePromiseKit().promise;

export const makeTimeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const makeTimeoutReject = (ms, message) => makeTimeout(ms).then(() => { throw Error(message) });
