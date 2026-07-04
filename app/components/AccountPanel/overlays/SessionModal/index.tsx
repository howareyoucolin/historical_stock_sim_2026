'use client'

import { useEffect, useState } from 'react'

import './style.css'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { closeSessionModal } from '../../../../store/uiSlice'
import { setSessionError } from '../../../../store/sessionSlice'
import { createSession, deleteSession, loadSessions, resetCurrentSession, switchSession } from './actions'

// How many sessions per page in the modal list.
const PAGE_SIZE = 6

// Session management modal: paginated session list with load/delete, reset-current, and new-session.
// Renders nothing while closed.
export function SessionModal() {
    const dispatch = useAppDispatch()
    const isOpen = useAppSelector((state) => state.ui.isSessionModalOpen)
    const sessions = useAppSelector((state) => state.session.sessions)
    const active = useAppSelector((state) => state.session.active)
    const error = useAppSelector((state) => state.session.error)
    const isBusy = useAppSelector((state) => state.account.isBusy)
    const [newName, setNewName] = useState('')
    const [page, setPage] = useState(0)
    const [confirmReset, setConfirmReset] = useState(false)
    // Name of the session pending a delete confirmation (null = none), so a misclick can't delete.
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

    // Refresh the session list each time the modal opens, and reset transient UI state.
    useEffect(() => {
        if (isOpen) {
            void dispatch(loadSessions())
            setPage(0)
            setConfirmReset(false)
            setConfirmDelete(null)
            dispatch(setSessionError(null))
        }
    }, [isOpen, dispatch])

    if (!isOpen) {
        return null
    }

    const pageCount = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE))
    const clampedPage = Math.min(page, pageCount - 1)
    const pageSessions = sessions.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)

    const handleCreate = async () => {
        const name = newName.trim()
        if (!name) {
            return
        }
        await dispatch(createSession(name))
        setNewName('')
    }

    return (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="sessionTitle" onClick={() => dispatch(closeSessionModal())}>
            <div className="modalCard sessionModalCard" onClick={(event) => event.stopPropagation()}>
                <div className="sessionModalHead">
                    <h3 id="sessionTitle">Sessions</h3>
                    <button type="button" className="sessionModalClose" aria-label="Close" onClick={() => dispatch(closeSessionModal())}>
                        ✕
                    </button>
                </div>

                {/* Start a new named session. */}
                <div className="sessionModalNew">
                    <input
                        className="sessionModalInput"
                        type="text"
                        value={newName}
                        placeholder="New session name"
                        disabled={isBusy}
                        onChange={(event) => {
                            setNewName(event.target.value)
                            if (error) {
                                dispatch(setSessionError(null))
                            }
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                void handleCreate()
                            }
                        }}
                    />
                    <button type="button" className="sessionModalStart" disabled={isBusy} onClick={() => void handleCreate()}>
                        Start new
                    </button>
                </div>

                {error && <p className="sessionModalError">{error}</p>}

                {/* Paginated session list. */}
                <ul className="sessionModalList">
                    {pageSessions.map((session) => (
                        <li key={session.name} className={`sessionModalRow ${session.active ? 'sessionModalRowActive' : ''}`}>
                            <div className="sessionModalInfo">
                                <span className="sessionModalName">{session.name}</span>
                                <span className="sessionModalMeta">sim {session.date ?? '-'}</span>
                            </div>
                            {confirmDelete === session.name ? (
                                // Inline confirmation so a misclick can't delete a session.
                                <div className="sessionModalRowActions sessionModalConfirmDelete">
                                    <span className="sessionModalConfirmText">Delete?</span>
                                    <button
                                        type="button"
                                        className="sessionModalDeleteConfirm"
                                        disabled={isBusy}
                                        onClick={() => {
                                            setConfirmDelete(null)
                                            void dispatch(deleteSession(session.name))
                                        }}
                                    >
                                        Yes, delete
                                    </button>
                                    <button type="button" className="sessionModalCancel" disabled={isBusy} onClick={() => setConfirmDelete(null)}>
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="sessionModalRowActions">
                                    <button
                                        type="button"
                                        className="sessionModalLoad"
                                        disabled={session.active || isBusy}
                                        onClick={() => void dispatch(switchSession(session.name))}
                                    >
                                        {session.active ? 'Active' : 'Load'}
                                    </button>
                                    <button
                                        type="button"
                                        className="sessionModalDelete"
                                        disabled={session.name === 'default' || isBusy}
                                        title={session.name === 'default' ? 'The default session cannot be deleted' : `Delete ${session.name}`}
                                        onClick={() => setConfirmDelete(session.name)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>

                {/* Pagination controls. */}
                {pageCount > 1 && (
                    <div className="sessionModalPager">
                        <button type="button" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
                            ‹ Prev
                        </button>
                        <span className="sessionModalPageInfo">
                            Page {clampedPage + 1} of {pageCount}
                        </span>
                        <button type="button" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>
                            Next ›
                        </button>
                    </div>
                )}

                {/* Footer: reset the current (active) session, with an inline confirm. */}
                <div className="sessionModalFooter">
                    {confirmReset ? (
                        <div className="sessionModalConfirm">
                            <span>Reset "{active}" to the starting state?</span>
                            <button type="button" className="sessionModalCancel" disabled={isBusy} onClick={() => setConfirmReset(false)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="sessionModalResetConfirm"
                                disabled={isBusy}
                                onClick={() => {
                                    setConfirmReset(false)
                                    void dispatch(resetCurrentSession())
                                }}
                            >
                                Reset session
                            </button>
                        </div>
                    ) : (
                        <button type="button" className="sessionModalReset" disabled={isBusy} onClick={() => setConfirmReset(true)}>
                            Reset current session ({active})
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
