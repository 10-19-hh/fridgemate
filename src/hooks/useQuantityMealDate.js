import { useEffect, useState } from 'react';

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

export function useQuantityMealDate() {
  const [mealDate, setMealDate] = useState(localDate);
  useEffect(() => {
    const refreshDate = () => setMealDate(localDate());
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(refreshDate, midnight.getTime() - now.getTime() + 1);
    window.addEventListener('focus', refreshDate);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshDate);
    };
  }, [mealDate]);
  return mealDate;
}
