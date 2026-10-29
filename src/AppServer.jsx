import AppShell from './components/AppShell';
import AppRoutes from './components/AppRoutes';
import AboutPage from './pages/AboutPage';
import AccountPage from './pages/AccountPage';
import ContactPage from './pages/ContactPage';
import HomePage from './pages/HomePage';
import GuidePage from './pages/GuidePage';
import ImportPage from './pages/ImportPage';
import IngredientHubPage from './pages/IngredientHubPage';
import IngredientFormPage from './pages/IngredientFormPage';
import IngredientsPage from './pages/IngredientsPage';
import LoginPage from './pages/LoginPage';
import MealPlanPage from './pages/MealPlanPage';
import MealPlanPilotPage from './pages/MealPlanPilotPage';
import NotFoundPage from './pages/NotFoundPage';
import PrivacyPage from './pages/PrivacyPage';
import PublicRecipePage from './pages/PublicRecipePage';
import RecipesPage from './pages/RecipesPage';
import SignupPage from './pages/SignupPage';
import { isOcrEnabled } from './utils/backendConfig';

const pages = {
  AboutPage,
  AccountPage,
  ContactPage,
  HomePage,
  GuidePage,
  ImportPage,
  IngredientHubPage,
  IngredientFormPage,
  IngredientsPage,
  LoginPage,
  MealPlanPage,
  MealPlanPilotPage,
  NotFoundPage,
  PrivacyPage,
  PublicRecipePage,
  RecipesPage,
  SignupPage
};

function AppServer() {
  return (
    <AppShell>
      <AppRoutes pages={pages} ocrEnabled={isOcrEnabled()} />
    </AppShell>
  );
}

export default AppServer;
