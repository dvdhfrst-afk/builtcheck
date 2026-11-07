// The parts of the schema.org type hierarchy that the required-field rule needs, so a
// "Plumber" is held to the LocalBusiness requirements and a "BlogPosting" to Article's.

const LOCAL_BUSINESS = [
  "AnimalShelter", "ArchiveOrganization", "AutomotiveBusiness", "AutoBodyShop", "AutoDealer",
  "AutoPartsStore", "AutoRental", "AutoRepair", "AutoWash", "GasStation", "MotorcycleDealer",
  "MotorcycleRepair", "ChildCare", "Dentist", "DryCleaningOrLaundry", "EmergencyService",
  "FireStation", "Hospital", "PoliceStation", "EmploymentAgency", "EntertainmentBusiness",
  "AdultEntertainment", "AmusementPark", "ArtGallery", "Casino", "ComedyClub", "MovieTheater",
  "NightClub", "FinancialService", "AccountingService", "AutomatedTeller", "BankOrCreditUnion",
  "InsuranceAgency", "FoodEstablishment", "Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop",
  "Distillery", "FastFoodRestaurant", "IceCreamShop", "Restaurant", "Winery", "GovernmentOffice",
  "PostOffice", "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "HairSalon", "HealthClub",
  "NailSalon", "TattooParlor", "HomeAndConstructionBusiness", "Electrician", "GeneralContractor",
  "HVACBusiness", "HousePainter", "Locksmith", "MovingCompany", "Plumber", "RoofingContractor",
  "InternetCafe", "LegalService", "Attorney", "Notary", "Library", "LodgingBusiness",
  "BedAndBreakfast", "Campground", "Hostel", "Hotel", "Motel", "Resort", "SkiResort",
  "VacationRental", "MedicalBusiness", "CommunityHealth", "DiagnosticLab", "MedicalClinic",
  "Optician", "Pharmacy", "Physician", "IndividualPhysician", "PhysiciansOffice", "ProfessionalService",
  "RadioStation", "RealEstateAgent", "RecyclingCenter", "SelfStorage", "ShoppingCenter",
  "SportsActivityLocation", "BowlingAlley", "ExerciseGym", "GolfCourse", "PublicSwimmingPool",
  "SkiResort", "SportsClub", "StadiumOrArena", "TennisComplex", "Store", "AutoPartsStore",
  "BikeStore", "BookStore", "ClothingStore", "ComputerStore", "ConvenienceStore", "DepartmentStore",
  "ElectronicsStore", "Florist", "FurnitureStore", "GardenStore", "GroceryStore", "HardwareStore",
  "HobbyShop", "HomeGoodsStore", "JewelryStore", "LiquorStore", "MensClothingStore",
  "MobilePhoneStore", "MovieRentalStore", "MusicStore", "OfficeEquipmentStore", "OutletStore",
  "PawnShop", "PetStore", "ShoeStore", "SportingGoodsStore", "TireShop", "ToyStore",
  "WholesaleStore", "TelevisionStation", "TouristInformationCenter", "TravelAgency",
];

const ARTICLE = [
  "AdvertiserContentArticle", "NewsArticle", "AnalysisNewsArticle", "AskPublicNewsArticle",
  "BackgroundNewsArticle", "OpinionNewsArticle", "ReportageNewsArticle", "ReviewNewsArticle",
  "Report", "SatiricalArticle", "ScholarlyArticle", "MedicalScholarlyArticle",
  "SocialMediaPosting", "BlogPosting", "LiveBlogPosting", "DiscussionForumPosting", "TechArticle",
  "APIReference",
];

const BUILT_IN_SUBTYPES = { LocalBusiness: LOCAL_BUSINESS, Article: ARTICLE };

const lookup = new Map();
for (const [parent, children] of Object.entries(BUILT_IN_SUBTYPES)) {
  lookup.set(parent, new Set(children));
}

// `extra` is the user's optional { Parent: ["Child", ...] } map.
export function isTypeOrSubtype(type, parent, extra = {}) {
  if (type === parent) return true;
  if (lookup.get(parent)?.has(type)) return true;
  return Array.isArray(extra[parent]) && extra[parent].includes(type);
}
