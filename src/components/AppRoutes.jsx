import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';

function AppRoutes({ pages, ocrEnabled }) {
  const {
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
  } = pages;

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/ingredients" element={<IngredientsPage />} />
      <Route path="/ingredients/new" element={<IngredientFormPage />} />
      <Route path="/ingredients/:ingredientId/edit" element={<IngredientFormPage />} />
      <Route path="/import" element={ocrEnabled ? <ImportPage /> : <Navigate to="/" replace />} />
      <Route path="/recipes" element={<RecipesPage />} />
      <Route path="/meal-plan" element={<MealPlanPage />} />
      <Route path="/pilot" element={<MealPlanPilotPage />} />
      <Route path="/recipes/ingredients/:ingredientSlug" element={<IngredientHubPage />} />
      <Route path="/recipes/:recipeSlug" element={<PublicRecipePage />} />
      <Route path="/guides/:guideSlug" element={<GuidePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default AppRoutes;
