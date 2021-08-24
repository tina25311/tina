'use strict'

Promise.allSettled = (iterable) =>
  Promise.all(
    iterable.map((it) =>
      it.then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason })
      )
    )
  )
