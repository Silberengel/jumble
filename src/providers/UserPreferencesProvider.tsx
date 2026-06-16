import storage from '@/services/local-storage.service'
import { TNotificationStyle } from '@/types'
import { createContext, useContext, useState } from 'react'

type TUserPreferencesContext = {
  notificationListStyle: TNotificationStyle
  updateNotificationListStyle: (style: TNotificationStyle) => void
  addRandomRelaysToPublish: boolean
  updateAddRandomRelaysToPublish: (value: boolean) => void
  showLiveActivitiesBanner: boolean
  updateShowLiveActivitiesBanner: (value: boolean) => void
}

const UserPreferencesContext = createContext<TUserPreferencesContext | undefined>(undefined)

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext)
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider')
  }
  return context
}

/** When context is missing (e.g. HMR or misplaced tree), returns `undefined` instead of throwing. */
export function useUserPreferencesOptional(): TUserPreferencesContext | undefined {
  return useContext(UserPreferencesContext)
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [notificationListStyle, setNotificationListStyle] = useState(
    storage.getNotificationListStyle()
  )

  const [addRandomRelaysToPublish, setAddRandomRelaysToPublish] = useState(
    storage.getAddRandomRelaysToPublish()
  )

  const [showLiveActivitiesBanner, setShowLiveActivitiesBanner] = useState(
    storage.getShowLiveActivitiesBanner()
  )

  const updateNotificationListStyle = (style: TNotificationStyle) => {
    setNotificationListStyle(style)
    storage.setNotificationListStyle(style)
  }

  const updateAddRandomRelaysToPublish = (value: boolean) => {
    setAddRandomRelaysToPublish(value)
    storage.setAddRandomRelaysToPublish(value)
  }

  const updateShowLiveActivitiesBanner = (value: boolean) => {
    setShowLiveActivitiesBanner(value)
    storage.setShowLiveActivitiesBanner(value)
  }

  return (
    <UserPreferencesContext.Provider
      value={{
        notificationListStyle,
        updateNotificationListStyle,
        addRandomRelaysToPublish,
        updateAddRandomRelaysToPublish,
        showLiveActivitiesBanner,
        updateShowLiveActivitiesBanner
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  )
}
