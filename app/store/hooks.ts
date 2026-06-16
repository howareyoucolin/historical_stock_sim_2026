import { useDispatch, useSelector } from 'react-redux'

import type { AppDispatch, RootState } from './index'

// Typed dispatch hook that understands the app's thunks, used in place of the untyped useDispatch.
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()

// Typed selector hook bound to RootState so components can read slice state without re-annotating.
export const useAppSelector = useSelector.withTypes<RootState>()
